import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { PartnerRole } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { KvService } from '../../common/kv/kv.service';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService, type ClientInfo } from '../identity/auth.service';
import { indianPhone } from '../identity/phone';
import type { StoreAccess } from '../partners/partner-access.service';
import type { Actor } from '../onboarding/onboarding.service';

/** Which roles each role may invite or manage (plan §4.2: managers cannot touch owners, bank or managers). */
const MANAGEABLE: Record<PartnerRole, PartnerRole[]> = {
  OWNER: ['MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST', 'ACCOUNTANT'],
  MANAGER: ['KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST'],
  KITCHEN_LEAD: [],
  COUNTER_STAFF: [],
  PHARMACIST: [],
  ACCOUNTANT: [],
};

const PIN_MAX_FAILS = 5;
const PIN_LOCK_SECONDS = 15 * 60;
const PIN_SESSION_HOURS = 12;
const WEAK_PINS = new Set(['1234', '4321', '0123', '1212', '2580']);

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly kv: KvService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
    private readonly auth: AuthService,
  ) {}

  /** Members who can work in this outlet (account-wide members + those scoped to it). */
  async list(storeId: string, access: StoreAccess) {
    const members = await this.prisma.partnerMember.findMany({
      where: { partnerAccountId: access.partnerAccountId, OR: [{ storeIds: { isEmpty: true } }, { storeIds: { has: storeId } }] },
      include: { user: { select: { id: true, phone: true, fullName: true, lastLoginAt: true } } },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    const stores = await this.prisma.store.findMany({ where: { partnerAccountId: access.partnerAccountId }, select: { id: true, name: true } });
    return {
      canManage: MANAGEABLE[access.role],
      stores,
      members: members.map((m) => ({
        id: m.id,
        userId: m.userId,
        name: m.user.fullName,
        phone: m.user.phone, // only owners/managers can call this endpoint
        role: m.role,
        storeIds: m.storeIds,
        status: !m.isActive && !m.acceptedAt ? 'INVITED' : m.isActive ? 'ACTIVE' : 'DEACTIVATED',
        hasPin: !!m.pinHash,
        lastLoginAt: m.user.lastLoginAt,
        createdAt: m.createdAt,
      })),
    };
  }

  async invite(storeId: string, input: { phone: string; name?: string; role: PartnerRole; storeIds?: string[] }, access: StoreAccess, actor: Actor) {
    if (!MANAGEABLE[access.role].includes(input.role)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ROLE_NOT_ALLOWED', `Your role (${access.role}) cannot add a ${input.role.replace('_', ' ').toLowerCase()}`);
    }
    const parsed = indianPhone.safeParse(input.phone);
    if (!parsed.success) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Enter a valid 10-digit mobile number', { fieldErrors: { phone: ['Invalid number'] } });
    const phone = parsed.data;
    const storeIds = await this.resolveStoreScope(storeId, input.storeIds, access);

    const result = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({ where: { phone }, update: {}, create: { phone, fullName: input.name } });
      if (!user.fullName && input.name) await tx.user.update({ where: { id: user.id }, data: { fullName: input.name } });
      const existing = await tx.partnerMember.findUnique({ where: { userId_partnerAccountId: { userId: user.id, partnerAccountId: access.partnerAccountId } } });
      if (existing?.isActive) throw new ApiError(HttpStatus.CONFLICT, 'ALREADY_MEMBER', 'This person is already on your team');
      if (existing?.role === 'OWNER') throw new ApiError(HttpStatus.CONFLICT, 'ALREADY_MEMBER', 'This person is an owner of this account');

      const data = { role: input.role, storeIds, isActive: false, acceptedAt: null, invitedByUserId: actor.userId, pinHash: null };
      const member = existing
        ? await tx.partnerMember.update({ where: { id: existing.id }, data })
        : await tx.partnerMember.create({ data: { ...data, userId: user.id, partnerAccountId: access.partnerAccountId } });

      await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'PartnerMember', entityId: member.id, action: 'CREATE', after: { phone: maskPhone(phone), role: input.role, storeIds }, ip: actor.ip }, tx);
      await this.events.publish(tx, { type: 'staff.invited', data: { storeId, memberId: member.id, role: input.role }, actor: { type: 'PARTNER', userId: actor.userId, role: access.role }, correlationId: actor.correlationId });
      return member;
    });

    // The invite also goes out by SMS + WhatsApp (NotificationsService on staff.invited); this log is for local debugging.
    const link = `${process.env.PARTNERS_WEB_URL ?? 'http://localhost:5173'}/login?next=/accounts`;
    this.logger.warn(`[INVITE] ${phone} invited as ${input.role} — ${link}`);
    return { memberId: result.id, status: 'INVITED', inviteLink: link };
  }

  async update(storeId: string, memberId: string, input: { role?: PartnerRole; storeIds?: string[]; isActive?: boolean }, access: StoreAccess, actor: Actor) {
    const member = await this.loadManageable(memberId, access, actor);
    if (input.role && !MANAGEABLE[access.role].includes(input.role)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ROLE_NOT_ALLOWED', `Your role cannot assign ${input.role.replace('_', ' ').toLowerCase()}`);
    }
    const storeIds = input.storeIds ? await this.resolveStoreScope(storeId, input.storeIds, access) : undefined;
    if (input.isActive === true && !member.acceptedAt) {
      throw new ApiError(HttpStatus.CONFLICT, 'INVITE_PENDING', 'They will be activated when they log in for the first time');
    }
    const updated = await this.prisma.partnerMember.update({
      where: { id: memberId },
      data: { role: input.role, storeIds, isActive: input.isActive, pinHash: input.isActive === false ? null : undefined },
    });
    if (input.isActive === false) await this.revokeSessionsOf(member.userId, access.partnerAccountId);
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'PartnerMember', entityId: memberId, action: 'UPDATE', before: { role: member.role, storeIds: member.storeIds, isActive: member.isActive }, after: input, ip: actor.ip });
    return { id: updated.id, role: updated.role, storeIds: updated.storeIds, isActive: updated.isActive };
  }

  async remove(memberId: string, access: StoreAccess, actor: Actor) {
    const member = await this.loadManageable(memberId, access, actor);
    await this.prisma.partnerMember.delete({ where: { id: memberId } });
    await this.revokeSessionsOf(member.userId, access.partnerAccountId);
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'PartnerMember', entityId: memberId, action: 'DELETE', before: { role: member.role }, ip: actor.ip });
  }

  // ------------------------------------------------------------------
  // Shared-tablet PIN switch (plan §4.3)
  // ------------------------------------------------------------------

  async setPin(access: StoreAccess, userId: string, pin: string) {
    if (/^(\d)\1{3}$/.test(pin) || WEAK_PINS.has(pin)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'PIN_TOO_SIMPLE', 'Choose a PIN that is harder to guess');
    }
    await this.prisma.partnerMember.update({
      where: { userId_partnerAccountId: { userId, partnerAccountId: access.partnerAccountId } },
      data: { pinHash: hashPin(pin) },
    });
    await this.audit.log({ actorUserId: userId, actorType: 'USER', entity: 'PartnerMember', entityId: userId, action: 'UPDATE', after: { pin: 'set' } });
    return { hasPin: true };
  }

  async switchable(storeId: string, access: StoreAccess) {
    const members = await this.prisma.partnerMember.findMany({
      where: { partnerAccountId: access.partnerAccountId, isActive: true, pinHash: { not: null }, OR: [{ storeIds: { isEmpty: true } }, { storeIds: { has: storeId } }] },
      include: { user: { select: { fullName: true, phone: true } } },
      orderBy: { role: 'asc' },
    });
    return members.map((m) => ({ memberId: m.id, name: m.user.fullName ?? maskPhone(m.user.phone), role: m.role }));
  }

  async pinSwitch(storeId: string, memberId: string, pin: string, current: { userId: string; sessionId: string }, access: StoreAccess, client: ClientInfo) {
    const member = await this.prisma.partnerMember.findFirst({
      where: { id: memberId, partnerAccountId: access.partnerAccountId, isActive: true, OR: [{ storeIds: { isEmpty: true } }, { storeIds: { has: storeId } }] },
      include: { user: { select: { id: true, phone: true, fullName: true, status: true } } },
    });
    if (!member?.pinHash || member.user.status !== 'ACTIVE') throw new ApiError(HttpStatus.NOT_FOUND, 'PIN_NOT_SET', 'This person has not set a PIN for this outlet');

    const failKey = `pin:fail:${memberId}`;
    const fails = Number((await this.kv.get(failKey)) ?? 0);
    if (fails >= PIN_MAX_FAILS) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'PIN_LOCKED', 'Too many wrong PINs. Log in with OTP or try again in 15 minutes.');
    if (!verifyPin(pin, member.pinHash)) {
      const n = await this.kv.incr(failKey, PIN_LOCK_SECONDS);
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'PIN_INCORRECT', `Wrong PIN. ${Math.max(0, PIN_MAX_FAILS - n)} tries left.`);
    }
    await this.kv.del(failKey);

    const tokens = await this.auth.issueSession(member.userId, 'PARTNERS', { ...client, device: { ...(client.device ?? {}), via: 'PIN_SWITCH', storeId }, ttlHours: PIN_SESSION_HOURS });
    // The person who handed over the tablet is signed out on this device.
    if (current.userId !== member.userId) await this.auth.logout(current.userId, current.sessionId, client.ip);
    return { ...tokens, user: { id: member.user.id, phone: member.user.phone, fullName: member.user.fullName }, role: member.role };
  }

  // ------------------------------------------------------------------

  private async loadManageable(memberId: string, access: StoreAccess, actor: Actor) {
    const member = await this.prisma.partnerMember.findFirst({ where: { id: memberId, partnerAccountId: access.partnerAccountId } });
    if (!member) throw new ApiError(HttpStatus.NOT_FOUND, 'MEMBER_NOT_FOUND', 'Team member not found');
    if (member.userId === actor.userId) throw new ApiError(HttpStatus.FORBIDDEN, 'CANNOT_EDIT_SELF', 'You cannot change your own access');
    if (!MANAGEABLE[access.role].includes(member.role)) throw new ApiError(HttpStatus.FORBIDDEN, 'ROLE_NOT_ALLOWED', `Your role cannot manage a ${member.role.replace('_', ' ').toLowerCase()}`);
    return member;
  }

  /** Validates an outlet scope: owners may grant any outlet (or all = []), others only outlets they can see. */
  private async resolveStoreScope(storeId: string, requested: string[] | undefined, access: StoreAccess) {
    if (requested === undefined) return [storeId];
    if (requested.length === 0) {
      if (access.role !== 'OWNER') throw new ApiError(HttpStatus.FORBIDDEN, 'ROLE_NOT_ALLOWED', 'Only owners can grant access to every outlet');
      return [];
    }
    const valid = await this.prisma.store.count({ where: { id: { in: requested }, partnerAccountId: access.partnerAccountId } });
    if (valid !== new Set(requested).size) throw new ApiError(HttpStatus.BAD_REQUEST, 'STORE_SCOPE_INVALID', 'One of the outlets is not part of your account');
    if (access.role !== 'OWNER' && requested.some((id) => id !== storeId)) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ROLE_NOT_ALLOWED', 'You can only add people to this outlet');
    }
    return [...new Set(requested)];
  }

  /** Ends the removed member's Partners sessions so access stops immediately. */
  private async revokeSessionsOf(userId: string, partnerAccountId: string) {
    const stillMember = await this.prisma.partnerMember.count({ where: { userId, isActive: true, partnerAccountId: { not: partnerAccountId } } });
    if (stillMember) return; // they work for another partner account too; store guards already block this one
    const sessions = await this.prisma.session.findMany({ where: { userId, app: 'PARTNERS', revokedAt: null } });
    for (const s of sessions) await this.auth.logout(userId, s.id);
  }
}

function hashPin(pin: string) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(pin, salt, 32).toString('base64')}`;
}

function verifyPin(pin: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const actual = scryptSync(pin, Buffer.from(salt, 'base64'), expected.length);
  return timingSafeEqual(actual, expected);
}

const maskPhone = (p: string) => (p.length > 6 ? `${p.slice(0, 5)}•••••${p.slice(-2)}` : p);
