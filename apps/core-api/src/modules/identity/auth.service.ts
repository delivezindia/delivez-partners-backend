import { HttpStatus, Injectable } from '@nestjs/common';
import type { AppId, Prisma } from '@delivez/db';
import { PrismaService } from '../../prisma/prisma.service';
import { KvService } from '../../common/kv/kv.service';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { ACCESS_TTL_SECONDS, REFRESH_TTL_DAYS, TokenService } from './token.service';
import { revokedSessionKey } from './auth.guard';

export interface ClientInfo {
  ip?: string;
  userAgent?: string;
  device?: Record<string, unknown>;
  correlationId?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly kv: KvService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Called after a successful OTP verification. One user row per phone across all apps. */
  async login(phone: string, app: AppId, client: ClientInfo) {
    const refresh = this.tokens.newRefreshToken();

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({ where: { phone }, include: { adminUser: true } });
      if (existing && existing.status !== 'ACTIVE') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'USER_BLOCKED', 'This account is not active. Contact Delivez support.');
      }
      if (app === 'ADMIN' && !existing?.adminUser?.isActive) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'NOT_AN_ADMIN', 'This number is not registered for the admin console');
      }

      const user = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { phoneVerified: true, lastLoginAt: new Date() } })
        : await tx.user.create({ data: { phone, phoneVerified: true, lastLoginAt: new Date() } });

      // Staff invites (plan §4.3) are created inactive and activate on the invitee's next Partners login.
      // Members an owner deactivated keep acceptedAt, so they are not reactivated here.
      // Every Local (customer app) login has a customer profile for orders, carts and addresses.
      if (app === 'LOCAL') await tx.customer.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
      if (app === 'PARTNERS') {
        await tx.partnerMember.updateMany({ where: { userId: user.id, isActive: false, acceptedAt: null }, data: { isActive: true, acceptedAt: new Date() } });
      }

      const session = await tx.session.create({
        data: {
          userId: user.id,
          app,
          refreshTokenHash: refresh.hash,
          deviceInfo: (client.device ?? undefined) as Prisma.InputJsonValue | undefined,
          ip: client.ip,
          expiresAt: new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
        },
      });

      await this.audit.log(
        { actorUserId: user.id, actorType: 'USER', entity: 'Session', entityId: session.id, action: 'LOGIN', after: { app }, ip: client.ip },
        tx,
      );
      if (!existing) {
        await this.events.publish(tx, {
          type: 'user.created',
          data: { userId: user.id, app },
          actor: { type: 'USER', userId: user.id },
          correlationId: client.correlationId,
        });
      }
      return { user, session, isNew: !existing };
    });

    return {
      accessToken: this.tokens.signAccess({ sub: result.user.id, app, sid: result.session.id }),
      refreshToken: refresh.token,
      expiresIn: ACCESS_TTL_SECONDS,
      user: {
        id: result.user.id,
        phone: result.user.phone,
        fullName: result.user.fullName,
        language: result.user.language,
        isNew: result.isNew,
      },
      memberships: app === 'PARTNERS' ? await this.partnerMemberships(result.user.id) : [],
    };
  }

  /** Issues a new session for an already-verified user (used by the shared-tablet PIN switch). */
  async issueSession(userId: string, app: AppId, client: ClientInfo & { ttlHours?: number }) {
    const refresh = this.tokens.newRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        app,
        refreshTokenHash: refresh.hash,
        deviceInfo: (client.device ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: client.ip,
        expiresAt: new Date(Date.now() + (client.ttlHours ?? REFRESH_TTL_DAYS * 24) * 60 * 60 * 1000),
      },
    });
    await this.prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
    await this.audit.log({ actorUserId: userId, actorType: 'USER', entity: 'Session', entityId: session.id, action: 'LOGIN', after: { app, via: client.device?.via ?? 'session' }, ip: client.ip });
    return {
      accessToken: this.tokens.signAccess({ sub: userId, app, sid: session.id }),
      refreshToken: refresh.token,
      expiresIn: ACCESS_TTL_SECONDS,
    };
  }

  /** Rotates the refresh token: the old one stops working immediately. */
  async refresh(refreshToken: string) {
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: this.tokens.hashRefresh(refreshToken) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date() || session.user.status !== 'ACTIVE') {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'REFRESH_INVALID', 'Session expired. Please log in again.');
    }
    const next = this.tokens.newRefreshToken();
    const rotated = await this.prisma.session.updateMany({
      where: { id: session.id, refreshTokenHash: session.refreshTokenHash },
      data: { refreshTokenHash: next.hash },
    });
    if (rotated.count === 0) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'REFRESH_INVALID', 'Session expired. Please log in again.');
    }
    return {
      accessToken: this.tokens.signAccess({ sub: session.userId, app: session.app, sid: session.id }),
      refreshToken: next.token,
      expiresIn: ACCESS_TTL_SECONDS,
    };
  }

  async logout(userId: string, sessionId: string, ip?: string) {
    await this.prisma.session.updateMany({ where: { id: sessionId, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    // Access tokens are stateless; remember the revocation until they would have expired anyway.
    await this.kv.set(revokedSessionKey(sessionId), '1', ACCESS_TTL_SECONDS);
    await this.audit.log({ actorUserId: userId, actorType: 'USER', entity: 'Session', entityId: sessionId, action: 'LOGOUT', ip });
  }

  async partnerMemberships(userId: string) {
    const members = await this.prisma.partnerMember.findMany({
      where: { userId, isActive: true, partnerAccount: { isActive: true } },
      include: {
        partnerAccount: {
          select: {
            id: true,
            displayName: true,
            stores: {
              where: { status: { notIn: ['CLOSED', 'REJECTED'] } },
              select: {
                id: true,
                name: true,
                slug: true,
                vertical: true,
                storeType: true,
                status: true,
                openState: true,
                readinessScore: true,
                city: { select: { name: true } },
                zone: { select: { name: true } },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    return members.map((m) => ({
      partnerAccountId: m.partnerAccountId,
      displayName: m.partnerAccount.displayName,
      role: m.role,
      storeIds: m.storeIds,
      stores: m.partnerAccount.stores.filter((s) => m.storeIds.length === 0 || m.storeIds.includes(s.id)),
    }));
  }
}
