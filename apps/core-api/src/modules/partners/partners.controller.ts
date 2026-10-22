import { Body, Controller, Get, HttpStatus, Param, ParseUUIDPipe, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from '../../common/api-exception.filter';
import { isWithinHours, nextOpening } from '../../common/hours';
import { RequireIdempotency } from '../../common/idempotency.interceptor';
import type { ApiRequest, AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { Apps, CurrentUser } from '../identity/auth.decorators';
import { AuthService } from '../identity/auth.service';
import type { StoreAccess } from './partner-access.service';
import { CurrentStore, PartnerRoles, StoreAccessGuard } from './store-access.guard';

const PARTNER_LEGAL_TYPES = ['PARTNER_TNC', 'SLA_TERMS', 'PENALTY_FRAMEWORK'] as const;

const openStateSchema = z.object({
  openState: z.enum(['OPEN', 'BUSY', 'CLOSED']),
  reason: z.string().max(200).optional(),
});

@ApiTags('partners')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('partners')
export class PartnersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  /** Memberships, stores and legal versions the user still has to accept (plan §13.2). */
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const [profile, memberships] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: user.userId },
        select: { id: true, phone: true, fullName: true, email: true, language: true },
      }),
      this.auth.partnerMemberships(user.userId),
    ]);

    const states = await this.prisma.city.findMany({
      where: { stores: { some: { id: { in: memberships.flatMap((m) => m.stores.map((s) => s.id)) } } } },
      select: { state: true },
      distinct: ['state'],
    });
    const activeDocs = await this.prisma.legalDocumentVersion.findMany({
      where: {
        isActive: true,
        effectiveFrom: { lte: new Date() },
        OR: [
          { type: { in: [...PARTNER_LEGAL_TYPES] } },
          { type: 'STATE_RIDER', state: { in: states.map((s) => s.state) } },
        ],
      },
      select: { id: true, type: true, version: true, state: true, contentUrl: true },
      orderBy: { effectiveFrom: 'desc' },
    });
    // Only the newest version of each document (per state for riders) is asked for.
    const seen = new Set<string>();
    const latestDocs = activeDocs.filter((d) => {
      const k = `${d.type}:${d.state ?? ''}`;
      return seen.has(k) ? false : (seen.add(k), true);
    });
    const accepted = await this.prisma.consentRecord.findMany({
      where: { userId: user.userId, legalDocId: { in: latestDocs.map((d) => d.id) } },
      select: { legalDocId: true },
    });
    const acceptedIds = new Set(accepted.map((c) => c.legalDocId));

    return {
      user: profile,
      memberships,
      pendingLegal: memberships.length ? latestDocs.filter((d) => !acceptedIds.has(d.id)) : [],
    };
  }

  @Get('stores/:storeId')
  async store(@Param('storeId', ParseUUIDPipe) storeId: string, @CurrentStore() access: StoreAccess) {
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      include: {
        city: { select: { name: true, state: true } },
        zone: { select: { name: true } },
        timings: { orderBy: [{ dayOfWeek: 'asc' }, { opensAt: 'asc' }] },
        _count: { select: { products: { where: { deletedAt: null } } } },
      },
    });
    // Messages from the Delivez team (admin "Send notice"), newest first, last 30 days.
    const notices = await this.prisma.adminAction.findMany({
      where: { storeId, type: 'SEND_WARNING', createdAt: { gte: new Date(Date.now() - 30 * 864e5) } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, reason: true, createdAt: true },
    });
    return { store, role: access.role, notices: notices.map((n) => ({ id: n.id, message: n.reason ?? '', at: n.createdAt })) };
  }

  /** Open / Busy / Closed toggle (plan §5.5). */
  @Put('stores/:storeId/open-state')
  @PartnerRoles('OWNER', 'MANAGER', 'KITCHEN_LEAD')
  @RequireIdempotency()
  async setOpenState(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body(new ZodValidationPipe(openStateSchema)) body: z.infer<typeof openStateSchema>,
    @CurrentUser() user: AuthUser,
    @CurrentStore() access: StoreAccess,
    @Req() req: ApiRequest,
  ) {
    if (body.openState !== 'CLOSED') {
      // Outside timings/holidays the scheduler would close the store again within a minute; say so instead.
      const s = await this.prisma.store.findUniqueOrThrow({
        where: { id: storeId },
        select: { timings: true, holidays: { where: { date: { gte: new Date(new Date().toISOString().slice(0, 10)) } } }, city: { select: { timezone: true } } },
      });
      const tz = s.city?.timezone ?? 'Asia/Kolkata';
      if (!isWithinHours(s.timings, s.holidays.map((h) => h.date), new Date(), tz)) {
        const next = nextOpening(s.timings, new Date(), tz);
        throw new ApiError(HttpStatus.CONFLICT, 'OUTSIDE_HOURS', `You're outside your opening hours${next ? ` — you open ${next}` : ''}. Change your hours in Settings to open now.`);
      }
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.store.findUniqueOrThrow({ where: { id: storeId }, select: { status: true, openState: true } });
      if (body.openState !== 'CLOSED' && !['LIVE', 'LIMITED'].includes(before.status)) {
        throw new ApiError(HttpStatus.CONFLICT, 'STORE_NOT_LIVE', 'The store can open once it is approved and live');
      }
      if (before.openState === body.openState) return { storeId, openState: before.openState };

      const store = await tx.store.update({
        where: { id: storeId },
        // A manual close is never auto-reopened by the hours scheduler (it only reopens AUTO_HOURS closes).
        data: { openState: body.openState, closedReason: body.openState === 'CLOSED' ? (body.reason ?? 'MANUAL') : null },
        select: { id: true, openState: true, closedReason: true },
      });
      await this.audit.log(
        {
          actorUserId: user.userId,
          actorType: 'USER',
          entity: 'Store',
          entityId: storeId,
          action: 'UPDATE',
          before: { openState: before.openState },
          after: { openState: store.openState },
          ip: req.ip,
        },
        tx,
      );
      await this.events.publish(tx, {
        type: 'store.open_state_changed',
        data: { storeId, from: before.openState, to: store.openState, reason: body.reason },
        actor: { type: 'PARTNER', userId: user.userId, role: access.role },
        correlationId: req.correlationId,
      });
      return { storeId, openState: store.openState };
    });
  }
}
