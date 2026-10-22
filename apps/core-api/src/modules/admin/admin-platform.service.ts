import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { AdminRole, LegalDocType, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SENIOR_ROLES, type AdminContext } from './admin.guard';

type Ctx = { ip?: string };

/**
 * Platform settings run from the admin console: the admin team, cities/zones/PIN codes,
 * legal document versions and the audit log (plan §7).
 */
@Injectable()
export class AdminPlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // -------------------------------------------------------------------
  // Admin team
  // -------------------------------------------------------------------

  async team() {
    const admins = await this.prisma.adminUser.findMany({
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      include: { user: { select: { phone: true, fullName: true, lastLoginAt: true } } },
    });
    const cities = await this.prisma.city.findMany({ select: { id: true, name: true } });
    const cityName = new Map(cities.map((c) => [c.id, c.name]));
    return admins.map((a) => ({
      id: a.id,
      userId: a.userId,
      phone: a.user.phone,
      fullName: a.user.fullName,
      role: a.role,
      cityIds: a.cityIds,
      cities: a.cityIds.map((id) => cityName.get(id) ?? 'Unknown city'),
      isActive: a.isActive,
      lastLoginAt: a.user.lastLoginAt,
      createdAt: a.createdAt,
    }));
  }

  async addAdmin(input: { phone: string; fullName: string; role: AdminRole; cityIds: string[] }, me: AdminContext, ctx: Ctx) {
    this.assertCanGrant(me, input.role);
    await this.assertCities(input.cityIds);
    const phone = input.phone; // already normalised to +91XXXXXXXXXX by the controller schema

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { phone },
        update: {},
        create: { phone, fullName: input.fullName.trim(), phoneVerified: false },
        include: { adminUser: true },
      });
      if (user.adminUser) throw new ApiError(HttpStatus.CONFLICT, 'ADMIN_EXISTS', 'This number already has admin access — edit it instead');
      if (!user.fullName) await tx.user.update({ where: { id: user.id }, data: { fullName: input.fullName.trim() } });
      const admin = await tx.adminUser.create({ data: { userId: user.id, role: input.role, cityIds: input.cityIds } });
      await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'AdminUser', entityId: admin.id, action: 'CREATE', after: { phone, role: input.role, cityIds: input.cityIds }, ip: ctx.ip }, tx);
      return { id: admin.id };
    });
  }

  async updateAdmin(id: string, patch: { role?: AdminRole; cityIds?: string[]; isActive?: boolean }, me: AdminContext, ctx: Ctx) {
    const target = await this.prisma.adminUser.findUnique({ where: { id } });
    if (!target) throw new ApiError(HttpStatus.NOT_FOUND, 'ADMIN_NOT_FOUND', 'Admin not found');
    if (target.id === me.adminId) throw new ApiError(HttpStatus.CONFLICT, 'CANNOT_EDIT_SELF', 'Ask another senior admin to change your own access');
    // Only a founder may change a founder/head of ops, or make someone one.
    this.assertCanGrant(me, target.role);
    if (patch.role) this.assertCanGrant(me, patch.role);
    if (patch.cityIds) await this.assertCities(patch.cityIds);
    if (patch.isActive === false && target.role === 'FOUNDER') {
      const founders = await this.prisma.adminUser.count({ where: { role: 'FOUNDER', isActive: true } });
      if (founders <= 1) throw new ApiError(HttpStatus.CONFLICT, 'LAST_FOUNDER', 'There must always be one active founder');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.adminUser.update({ where: { id }, data: patch });
      await this.audit.log(
        { actorUserId: me.userId, actorType: 'ADMIN', entity: 'AdminUser', entityId: id, action: 'UPDATE', before: { role: target.role, cityIds: target.cityIds, isActive: target.isActive }, after: patch, ip: ctx.ip },
        tx,
      );
      return u;
    });
    return { id: updated.id, role: updated.role, cityIds: updated.cityIds, isActive: updated.isActive };
  }

  private assertCanGrant(me: AdminContext, role: AdminRole) {
    if (SENIOR_ROLES.includes(role) && me.role !== 'FOUNDER') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'ROLE_NOT_ALLOWED', 'Only a founder can manage founders and heads of ops');
    }
  }

  private async assertCities(ids: string[]) {
    if (!ids.length) return;
    const found = await this.prisma.city.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw new ApiError(HttpStatus.BAD_REQUEST, 'CITY_NOT_FOUND', 'One of the cities does not exist');
  }

  // -------------------------------------------------------------------
  // Cities, zones and serviceable PIN codes
  // -------------------------------------------------------------------

  async cities() {
    const cities = await this.prisma.city.findMany({
      orderBy: { name: 'asc' },
      include: {
        zones: { orderBy: { name: 'asc' }, select: { id: true, name: true, isActive: true, _count: { select: { stores: true, pincodes: true } } } },
        _count: { select: { stores: true, pincodes: true } },
      },
    });
    const serviceable = await this.prisma.pincode.groupBy({ by: ['cityId'], where: { serviceable: true }, _count: { _all: true } });
    const sv = new Map(serviceable.map((g) => [g.cityId, g._count._all]));
    return cities.map((c) => ({
      id: c.id,
      name: c.name,
      state: c.state,
      isActive: c.isActive,
      centerLat: c.centerLat,
      centerLng: c.centerLng,
      stores: c._count.stores,
      pincodes: c._count.pincodes,
      serviceablePincodes: sv.get(c.id) ?? 0,
      zones: c.zones.map((z) => ({ id: z.id, name: z.name, isActive: z.isActive, stores: z._count.stores, pincodes: z._count.pincodes })),
    }));
  }

  async addCity(input: { name: string; state: string; centerLat: number; centerLng: number }, me: AdminContext, ctx: Ctx) {
    const exists = await this.prisma.city.findFirst({ where: { name: { equals: input.name.trim(), mode: 'insensitive' }, state: { equals: input.state.trim(), mode: 'insensitive' } } });
    if (exists) throw new ApiError(HttpStatus.CONFLICT, 'CITY_EXISTS', `${exists.name} already exists`);
    // New cities start inactive so nothing goes live there by accident.
    const city = await this.prisma.city.create({ data: { name: input.name.trim(), state: input.state.trim(), centerLat: input.centerLat, centerLng: input.centerLng, isActive: false } });
    await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'City', entityId: city.id, action: 'CREATE', after: input, ip: ctx.ip });
    return { id: city.id };
  }

  async updateCity(id: string, patch: { isActive?: boolean; centerLat?: number; centerLng?: number }, me: AdminContext, ctx: Ctx) {
    const before = await this.prisma.city.findUnique({ where: { id } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'CITY_NOT_FOUND', 'City not found');
    await this.prisma.city.update({ where: { id }, data: patch });
    await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'City', entityId: id, action: 'UPDATE', before: { isActive: before.isActive }, after: patch, ip: ctx.ip });
    return { id, ...patch };
  }

  async addZone(cityId: string, name: string, me: AdminContext, ctx: Ctx) {
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city) throw new ApiError(HttpStatus.NOT_FOUND, 'CITY_NOT_FOUND', 'City not found');
    const dup = await this.prisma.zone.findFirst({ where: { cityId, name: { equals: name.trim(), mode: 'insensitive' } } });
    if (dup) throw new ApiError(HttpStatus.CONFLICT, 'ZONE_EXISTS', `${dup.name} already exists in ${city.name}`);
    // Polygon boundaries come with the dispatch/maps work; zones group PIN codes until then.
    const zone = await this.prisma.zone.create({ data: { cityId, name: name.trim(), polygon: { type: 'Polygon', coordinates: [] } } });
    await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'Zone', entityId: zone.id, action: 'CREATE', after: { cityId, name }, ip: ctx.ip });
    return { id: zone.id };
  }

  async updateZone(id: string, patch: { isActive?: boolean; name?: string }, me: AdminContext, ctx: Ctx) {
    const zone = await this.prisma.zone.findUnique({ where: { id } });
    if (!zone) throw new ApiError(HttpStatus.NOT_FOUND, 'ZONE_NOT_FOUND', 'Zone not found');
    await this.prisma.zone.update({ where: { id }, data: { ...patch, name: patch.name?.trim() } });
    await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'Zone', entityId: id, action: 'UPDATE', before: { isActive: zone.isActive, name: zone.name }, after: patch, ip: ctx.ip });
    return { id, ...patch };
  }

  async pincodes(cityId: string) {
    return this.prisma.pincode.findMany({
      where: { cityId },
      orderBy: { code: 'asc' },
      select: { code: true, serviceable: true, zone: { select: { id: true, name: true } } },
    });
  }

  /** Adds or updates PIN codes for a city (bulk paste). */
  async upsertPincodes(cityId: string, input: { codes: string[]; zoneId?: string | null; serviceable: boolean }, me: AdminContext, ctx: Ctx) {
    const city = await this.prisma.city.findUnique({ where: { id: cityId } });
    if (!city) throw new ApiError(HttpStatus.NOT_FOUND, 'CITY_NOT_FOUND', 'City not found');
    if (input.zoneId) {
      const zone = await this.prisma.zone.findFirst({ where: { id: input.zoneId, cityId } });
      if (!zone) throw new ApiError(HttpStatus.BAD_REQUEST, 'ZONE_NOT_FOUND', 'That zone is not in this city');
    }
    const codes = [...new Set(input.codes)];
    const taken = await this.prisma.pincode.findMany({ where: { code: { in: codes }, NOT: { cityId } }, select: { code: true } });
    if (taken.length) throw new ApiError(HttpStatus.CONFLICT, 'PINCODE_OTHER_CITY', `Already in another city: ${taken.map((t) => t.code).join(', ')}`);

    await this.prisma.$transaction(
      codes.map((code) =>
        this.prisma.pincode.upsert({
          where: { code },
          update: { serviceable: input.serviceable, ...(input.zoneId !== undefined && { zoneId: input.zoneId }) },
          create: { code, cityId, zoneId: input.zoneId ?? null, serviceable: input.serviceable },
        }),
      ),
    );
    await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'City', entityId: cityId, action: 'UPDATE', after: { pincodes: codes, zoneId: input.zoneId, serviceable: input.serviceable }, ip: ctx.ip });
    return { saved: codes.length };
  }

  // -------------------------------------------------------------------
  // Legal document versions (what partners must accept)
  // -------------------------------------------------------------------

  async legalDocs() {
    const docs = await this.prisma.legalDocumentVersion.findMany({
      orderBy: [{ type: 'asc' }, { effectiveFrom: 'desc' }],
      include: { _count: { select: { consents: true } } },
    });
    const now = new Date();
    return docs.map((d) => ({
      id: d.id,
      type: d.type,
      version: d.version,
      state: d.state,
      vertical: d.vertical,
      contentUrl: d.contentUrl,
      contentHash: d.contentHash,
      effectiveFrom: d.effectiveFrom,
      isActive: d.isActive,
      inForce: d.isActive && d.effectiveFrom <= now,
      acceptances: d._count.consents,
    }));
  }

  /**
   * Publishes a new version. Partners see it on their next visit once `effectiveFrom` passes; earlier versions
   * of the same document stay on record (consents point at them) but stop being asked for.
   */
  async publishLegal(input: { type: LegalDocType; version: string; state?: string | null; contentUrl: string; effectiveFrom: Date }, me: AdminContext, ctx: Ctx) {
    if (input.type === 'STATE_RIDER' && !input.state) throw new ApiError(HttpStatus.BAD_REQUEST, 'STATE_REQUIRED', 'A state rider needs a state');
    const state = input.type === 'STATE_RIDER' ? input.state!.trim() : null;
    const dup = await this.prisma.legalDocumentVersion.findFirst({ where: { type: input.type, version: input.version, state } });
    if (dup) throw new ApiError(HttpStatus.CONFLICT, 'VERSION_EXISTS', `Version ${input.version} already exists`);

    const doc = await this.prisma.$transaction(async (tx) => {
      const created = await tx.legalDocumentVersion.create({
        data: {
          type: input.type,
          version: input.version.trim(),
          state,
          contentUrl: input.contentUrl.trim(),
          contentHash: createHash('sha256').update(`${input.type}:${input.version}:${state ?? ''}:${input.contentUrl}`).digest('hex'),
          effectiveFrom: input.effectiveFrom,
        },
      });
      await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'LegalDocumentVersion', entityId: created.id, action: 'CREATE', after: { ...input, state }, ip: ctx.ip }, tx);
      return created;
    });
    return { id: doc.id };
  }

  async setLegalActive(id: string, isActive: boolean, me: AdminContext, ctx: Ctx) {
    const doc = await this.prisma.legalDocumentVersion.findUnique({ where: { id } });
    if (!doc) throw new ApiError(HttpStatus.NOT_FOUND, 'LEGAL_NOT_FOUND', 'Document not found');
    await this.prisma.legalDocumentVersion.update({ where: { id }, data: { isActive } });
    await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'LegalDocumentVersion', entityId: id, action: 'UPDATE', before: { isActive: doc.isActive }, after: { isActive }, ip: ctx.ip });
    return { id, isActive };
  }

  // -------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------

  async auditLog(q: { entity?: string; entityId?: string; actorType?: string; action?: string; before?: Date; limit: number }) {
    const where: Prisma.AuditLogWhereInput = {
      ...(q.entity && { entity: q.entity }),
      ...(q.entityId && { entityId: q.entityId }),
      ...(q.actorType && { actorType: q.actorType }),
      ...(q.action && { action: q.action }),
      ...(q.before && { createdAt: { lt: q.before } }),
    };
    const rows = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      include: { actor: { select: { phone: true, fullName: true } } },
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({
        id: r.id,
        at: r.createdAt,
        actorType: r.actorType,
        actor: r.actor ? (r.actor.fullName ?? r.actor.phone) : null,
        entity: r.entity,
        entityId: r.entityId,
        action: r.action,
        before: r.before,
        after: r.after,
        ip: r.ip,
      })),
      // Cursor = timestamp of the last row; pass it back as `before` for the next page.
      nextBefore: rows.length > q.limit ? page[page.length - 1].createdAt : null,
    };
  }
}
