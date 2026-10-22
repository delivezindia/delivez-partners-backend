import { HttpStatus, Injectable } from '@nestjs/common';
import type { DocumentStatus, Prisma, StoreStatus } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { optionalDocuments, requiredDocuments } from '../onboarding/flows';
import { OnboardingService } from '../onboarding/onboarding.service';
import { docLabel } from '../onboarding/readiness';
import type { AdminContext } from './admin.guard';
import { assertCityScope, StoreLifecycleService } from './store-lifecycle.service';

const PIPELINE_STATUSES: StoreStatus[] = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'LIMITED', 'LIVE', 'PAUSED', 'SUSPENDED', 'REJECTED', 'CLOSED'];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly onboarding: OnboardingService,
    private readonly lifecycle: StoreLifecycleService,
  ) {}

  async me(admin: AdminContext) {
    const [user, cities] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: admin.userId }, select: { id: true, phone: true, fullName: true } }),
      this.prisma.city.findMany({ where: admin.cityIds.length ? { id: { in: admin.cityIds } } : {}, select: { id: true, name: true } }),
    ]);
    return { user, role: admin.role, cities, allCities: admin.cityIds.length === 0 };
  }

  // -------------------------------------------------------------------
  // Pipeline (plan §7: onboarding funnel by step, channel, city)
  // -------------------------------------------------------------------

  async pipeline(admin: AdminContext, filter: { status?: StoreStatus; q?: string; vertical?: string }) {
    const scope = storeScope(admin);
    const where: Prisma.StoreWhereInput = {
      AND: [
        scope,
        filter.status ? { status: filter.status } : {},
        filter.vertical ? { vertical: filter.vertical as Prisma.EnumVerticalFilter['equals'] } : {},
        filter.q
          ? {
              OR: [
                { name: { contains: filter.q, mode: 'insensitive' } },
                { phone: { contains: filter.q } },
                { pincode: { startsWith: filter.q } },
                { partnerAccount: { legalName: { contains: filter.q, mode: 'insensitive' } } },
              ],
            }
          : {},
      ],
    };

    const [stores, grouped] = await Promise.all([
      this.prisma.store.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }],
        take: 200,
        select: {
          id: true,
          name: true,
          vertical: true,
          storeType: true,
          status: true,
          readinessScore: true,
          pincode: true,
          phone: true,
          createdAt: true,
          updatedAt: true,
          city: { select: { name: true } },
          zone: { select: { name: true } },
          onboarding: { select: { status: true, channel: true, currentStep: true, completedSteps: true, flowVersion: true, submittedAt: true } },
          documents: { select: { type: true, status: true, createdAt: true }, orderBy: { createdAt: 'desc' } },
        },
      }),
      this.prisma.store.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
    ]);

    const counts = Object.fromEntries(PIPELINE_STATUSES.map((s) => [s, 0])) as Record<StoreStatus, number>;
    for (const g of grouped) counts[g.status] = g._count._all;

    return {
      counts,
      stores: stores.map(({ documents, ...s }) => {
        const required = requiredDocuments(s.storeType);
        const latest = latestStatus(documents);
        return {
          ...s,
          docs: {
            required: required.length,
            verified: required.filter((t) => latest.get(t) === 'VERIFIED').length,
            pending: [...latest.values()].filter((st) => st === 'PENDING' || st === 'UNDER_REVIEW').length,
            rejected: [...latest.values()].filter((st) => st === 'REJECTED').length,
          },
        };
      }),
    };
  }

  // -------------------------------------------------------------------
  // Store review page
  // -------------------------------------------------------------------

  async storeDetail(storeId: string, admin: AdminContext) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        partnerAccount: {
          include: { members: { include: { user: { select: { id: true, phone: true, fullName: true, lastLoginAt: true } } } } },
        },
        onboarding: { include: { events: { orderBy: { createdAt: 'desc' }, take: 50 } } },
        documents: { orderBy: { createdAt: 'desc' }, include: { reviewedBy: { include: { user: { select: { fullName: true, phone: true } } } } } },
        adminActions: { orderBy: { createdAt: 'desc' }, take: 20, include: { admin: { include: { user: { select: { fullName: true } } } } } },
      },
    });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    assertCityScope(admin, store.cityId);

    const view = store.onboarding ? await this.onboarding.view(storeId) : null;
    const [liveProblems, limitedProblems, consents] = await Promise.all([
      this.lifecycle.approvalProblems(storeId, 'LIVE'),
      this.lifecycle.approvalProblems(storeId, 'LIMITED'),
      this.prisma.consentRecord.findMany({
        where: { storeId },
        include: { legalDoc: { select: { type: true, version: true, state: true } }, user: { select: { phone: true } } },
        orderBy: { acceptedAt: 'desc' },
      }),
    ]);

    return {
      store: { id: store.id, name: store.name, status: store.status, vertical: store.vertical, storeType: store.storeType, rejectedReason: store.rejectedReason, liveAt: store.liveAt, createdAt: store.createdAt },
      onboarding: view,
      members: store.partnerAccount.members.map((m) => ({ memberId: m.id, role: m.role, isActive: m.isActive, invited: !m.isActive && !m.acceptedAt, ...m.user })),
      documents: store.documents.map((d) => ({
        id: d.id,
        type: d.type,
        label: docLabel(d.type),
        status: d.status,
        required: requiredDocuments(store.storeType).includes(d.type),
        documentNumber: d.documentNumber,
        issuedAt: d.issuedAt,
        expiresAt: d.expiresAt,
        fileHash: d.fileHash,
        rejectionReason: d.rejectionReason,
        reviewedBy: d.reviewedBy?.user.fullName ?? null,
        reviewedAt: d.reviewedAt,
        createdAt: d.createdAt,
        viewUrl: this.storage.signedReadUrl(d.fileUrl),
        contentType: d.fileUrl.endsWith('.pdf') ? 'application/pdf' : 'image',
      })),
      consents: consents.map((c) => ({ type: c.legalDoc.type, version: c.legalDoc.version, state: c.legalDoc.state, by: c.user.phone, ip: c.ip, channel: c.channel, acceptedAt: c.acceptedAt })),
      timeline: store.onboarding?.events.map((e) => ({ step: e.step, action: e.action, actorType: e.actorType, meta: e.meta, at: e.createdAt })) ?? [],
      adminActions: store.adminActions.map((a) => ({ type: a.type, reason: a.reason, params: a.params, by: a.admin.user.fullName, at: a.createdAt })),
      openState: store.openState,
      closedReason: store.closedReason,
      approval: { live: liveProblems, limited: limitedProblems },
    };
  }

  // -------------------------------------------------------------------
  // Document verification queue (plan §5.2, §7)
  // -------------------------------------------------------------------

  async documentQueue(admin: AdminContext, status: DocumentStatus | 'EXPIRING' = 'PENDING') {
    const soon = new Date(Date.now() + 30 * 864e5);
    const docs = await this.prisma.partnerDocument.findMany({
      where: {
        ...(status === 'EXPIRING' ? { status: 'VERIFIED' as const, expiresAt: { lte: soon } } : { status: status === 'PENDING' ? { in: ['PENDING', 'UNDER_REVIEW'] } : status }),
        store: admin.cityIds.length ? storeScope(admin) : undefined,
      },
      orderBy: status === 'EXPIRING' ? { expiresAt: 'asc' } : { createdAt: 'asc' },
      take: 200,
      include: {
        store: { select: { id: true, name: true, storeType: true, status: true, city: { select: { name: true } }, partnerAccount: { select: { legalName: true } } } },
      },
    });
    // Only the newest upload of each type per store is reviewable; older ones stay for audit.
    const newest = new Set<string>();
    const latestIds = await this.prisma.partnerDocument.findMany({
      where: { storeId: { in: [...new Set(docs.map((d) => d.storeId!).filter(Boolean))] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, storeId: true, type: true },
    });
    const seen = new Set<string>();
    for (const d of latestIds) {
      const k = `${d.storeId}:${d.type}`;
      if (!seen.has(k)) {
        seen.add(k);
        newest.add(d.id);
      }
    }

    return docs.map((d) => ({
      id: d.id,
      type: d.type,
      label: docLabel(d.type),
      status: d.status,
      required: d.store ? requiredDocuments(d.store.storeType).includes(d.type) : false,
      superseded: !newest.has(d.id),
      documentNumber: d.documentNumber,
      expiresAt: d.expiresAt,
      createdAt: d.createdAt,
      viewUrl: this.storage.signedReadUrl(d.fileUrl),
      contentType: d.fileUrl.endsWith('.pdf') ? 'application/pdf' : 'image',
      store: d.store ? { id: d.store.id, name: d.store.name, status: d.store.status, city: d.store.city?.name ?? null, legalName: d.store.partnerAccount.legalName } : null,
    }));
  }

  async reviewDocument(
    documentId: string,
    decision: { action: 'VERIFY'; documentNumber?: string; expiresAt?: Date } | { action: 'REJECT'; reason: string },
    admin: AdminContext,
    ctx: { ip?: string; correlationId?: string },
  ) {
    const doc = await this.prisma.partnerDocument.findUnique({ where: { id: documentId }, include: { store: { select: { id: true, cityId: true, status: true } } } });
    if (!doc) throw new ApiError(HttpStatus.NOT_FOUND, 'DOCUMENT_NOT_FOUND', 'Document not found');
    assertCityScope(admin, doc.store?.cityId ?? null);
    if (!['PENDING', 'UNDER_REVIEW', 'VERIFIED'].includes(doc.status) || (decision.action === 'VERIFY' && doc.status === 'VERIFIED')) {
      throw new ApiError(HttpStatus.CONFLICT, 'DOCUMENT_ALREADY_REVIEWED', `This document is already ${doc.status.toLowerCase()}`);
    }
    if (decision.action === 'VERIFY' && decision.expiresAt && decision.expiresAt < new Date()) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'DOCUMENT_EXPIRED', 'The expiry date is in the past — reject it instead');
    }
    const status: DocumentStatus = decision.action === 'VERIFY' ? 'VERIFIED' : 'REJECTED';

    await this.prisma.$transaction(async (tx) => {
      await tx.partnerDocument.update({
        where: { id: documentId },
        data: {
          status,
          reviewedById: admin.adminId,
          reviewedAt: new Date(),
          rejectionReason: decision.action === 'REJECT' ? decision.reason : null,
          documentNumber: decision.action === 'VERIFY' && decision.documentNumber ? decision.documentNumber.trim().toUpperCase() : undefined,
          expiresAt: decision.action === 'VERIFY' && decision.expiresAt ? decision.expiresAt : undefined,
        },
      });
      await this.audit.log(
        {
          actorUserId: admin.userId,
          actorType: 'ADMIN',
          entity: 'PartnerDocument',
          entityId: documentId,
          action: 'STATUS_CHANGE',
          before: { status: doc.status },
          after: { status, reason: decision.action === 'REJECT' ? decision.reason : undefined },
          ip: ctx.ip,
        },
        tx,
      );
      await this.events.publish(tx, {
        type: decision.action === 'VERIFY' ? 'document.verified' : 'document.rejected',
        data: { storeId: doc.storeId, documentId, type: doc.type, label: docLabel(doc.type), reason: decision.action === 'REJECT' ? decision.reason : undefined },
        actor: { type: 'ADMIN', userId: admin.userId, role: admin.role },
        correlationId: ctx.correlationId,
      });
    });

    if (doc.storeId) await this.onboarding.refreshReadiness(doc.storeId);
    return { id: documentId, status };
  }
// -------------------------------------------------------------------
  // Dashboard (plan §7: what needs attention right now)
  // -------------------------------------------------------------------

  async dashboard(admin: AdminContext) {
    const scope = storeScope(admin);
    const now = new Date();
    const soon = new Date(now.getTime() + 30 * 864e5);
    const weekAgo = new Date(now.getTime() - 7 * 864e5);
    const docScope = admin.cityIds.length ? { store: scope } : {};

    const [byStatus, byVertical, openNow, newThisWeek, liveThisWeek, docsPending, docsExpiring, waiting, oldestDocs, expiring, actions] = await Promise.all([
      this.prisma.store.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
      this.prisma.store.groupBy({ by: ['vertical'], where: { AND: [scope, { status: { in: ['LIVE', 'LIMITED'] } }] }, _count: { _all: true } }),
      this.prisma.store.count({ where: { AND: [scope, { status: { in: ['LIVE', 'LIMITED'] }, openState: { in: ['OPEN', 'BUSY'] } }] } }),
      this.prisma.store.count({ where: { AND: [scope, { createdAt: { gte: weekAgo } }] } }),
      this.prisma.store.count({ where: { AND: [scope, { liveAt: { gte: weekAgo } }] } }),
      this.prisma.partnerDocument.count({ where: { status: { in: ['PENDING', 'UNDER_REVIEW'] }, ...docScope } }),
      this.prisma.partnerDocument.count({ where: { status: 'VERIFIED', expiresAt: { lte: soon }, ...docScope } }),
      this.prisma.store.findMany({
        where: { AND: [scope, { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } }] },
        orderBy: { onboarding: { submittedAt: 'asc' } },
        take: 6,
        select: { id: true, name: true, status: true, vertical: true, readinessScore: true, city: { select: { name: true } }, onboarding: { select: { submittedAt: true } } },
      }),
      this.prisma.partnerDocument.findMany({
        where: { status: { in: ['PENDING', 'UNDER_REVIEW'] }, ...docScope },
        orderBy: { createdAt: 'asc' },
        take: 6,
        select: { id: true, type: true, createdAt: true, store: { select: { id: true, name: true } } },
      }),
      this.prisma.partnerDocument.findMany({
        where: { status: 'VERIFIED', expiresAt: { lte: soon }, ...docScope },
        orderBy: { expiresAt: 'asc' },
        take: 6,
        select: { id: true, type: true, expiresAt: true, store: { select: { id: true, name: true, status: true } } },
      }),
      this.prisma.adminAction.findMany({
        where: admin.cityIds.length ? { store: scope } : {},
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, type: true, reason: true, createdAt: true, store: { select: { id: true, name: true } }, admin: { select: { role: true, user: { select: { fullName: true } } } } },
      }),
    ]);

    const statusCounts = Object.fromEntries(PIPELINE_STATUSES.map((st) => [st, 0])) as Record<StoreStatus, number>;
    for (const g of byStatus) statusCounts[g.status] = g._count._all;

    return {
      statusCounts,
      liveByVertical: Object.fromEntries(byVertical.map((g) => [g.vertical, g._count._all])),
      openNow,
      newThisWeek,
      liveThisWeek,
      docsPending,
      docsExpiring,
      waitingReview: waiting.map((w) => ({ id: w.id, name: w.name, status: w.status, vertical: w.vertical, readinessScore: w.readinessScore, city: w.city?.name ?? null, submittedAt: w.onboarding?.submittedAt ?? null })),
      oldestDocuments: oldestDocs.map((d) => ({ id: d.id, label: docLabel(d.type), createdAt: d.createdAt, store: d.store })),
      expiringDocuments: expiring.map((d) => ({ id: d.id, label: docLabel(d.type), expiresAt: d.expiresAt, store: d.store })),
      recentActions: actions.map((a) => ({ id: a.id, type: a.type, reason: a.reason, at: a.createdAt, store: a.store, by: a.admin.user.fullName ?? a.admin.role })),
    };
  }

  // -------------------------------------------------------------------
  // Documents by shop: one row per store, one slot per required document
  // -------------------------------------------------------------------

  async documentsByStore(admin: AdminContext, q: { filter: 'NEEDS_REVIEW' | 'MISSING' | 'COMPLETE' | 'ALL'; vertical?: string; q?: string }) {
    const where: Prisma.StoreWhereInput = {
      AND: [
        storeScope(admin),
        { status: { notIn: ['CLOSED', 'REJECTED'] } },
        q.vertical ? { vertical: q.vertical as Prisma.EnumVerticalFilter['equals'] } : {},
        q.q ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }, { partnerAccount: { legalName: { contains: q.q, mode: 'insensitive' } } }] } : {},
      ],
    };
    const stores = await this.prisma.store.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: 300,
      select: {
        id: true,
        name: true,
        status: true,
        vertical: true,
        storeType: true,
        readinessScore: true,
        city: { select: { name: true } },
        partnerAccount: { select: { legalName: true } },
        documents: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, type: true, status: true, createdAt: true, fileUrl: true, documentNumber: true, expiresAt: true, rejectionReason: true, reviewedAt: true },
        },
      },
    });

    const soon = Date.now() + 30 * 864e5;
    const rows = stores.map((st) => {
      const latest = new Map<string, (typeof st.documents)[number]>();
      const count = new Map<string, number>();
      for (const d of st.documents) {
        if (!latest.has(d.type)) latest.set(d.type, d);
        count.set(d.type, (count.get(d.type) ?? 0) + 1);
      }
      const required = requiredDocuments(st.storeType);
      const optional = optionalDocuments(st.storeType).filter((t) => latest.has(t));
      const extra = [...latest.keys()].filter((t) => !required.includes(t as never) && !optional.includes(t as never));
      const slots = [...required.map((t) => ({ t, req: true })), ...[...optional, ...extra].map((t) => ({ t, req: false }))].map(({ t, req }) => {
        const d = latest.get(t);
        return {
          type: t,
          label: docLabel(t as never),
          required: req,
          uploads: count.get(t) ?? 0,
          doc: d
            ? {
                id: d.id,
                status: d.status,
                createdAt: d.createdAt,
                documentNumber: d.documentNumber,
                expiresAt: d.expiresAt,
                expiringSoon: d.status === 'VERIFIED' && !!d.expiresAt && d.expiresAt.getTime() <= soon,
                rejectionReason: d.rejectionReason,
                reviewedAt: d.reviewedAt,
                viewUrl: this.storage.signedReadUrl(d.fileUrl),
                contentType: d.fileUrl.endsWith('.pdf') ? 'application/pdf' : 'image',
              }
            : null,
        };
      });
      const req = slots.filter((x) => x.required);
      return {
        id: st.id,
        name: st.name,
        status: st.status,
        vertical: st.vertical,
        storeType: st.storeType,
        readinessScore: st.readinessScore,
        city: st.city?.name ?? null,
        legalName: st.partnerAccount.legalName,
        slots,
        summary: {
          required: req.length,
          verified: req.filter((x) => x.doc?.status === 'VERIFIED').length,
          toReview: slots.filter((x) => x.doc && ['PENDING', 'UNDER_REVIEW'].includes(x.doc.status)).length,
          missing: req.filter((x) => !x.doc || ['REJECTED', 'EXPIRED'].includes(x.doc.status)).length,
          expiringSoon: slots.filter((x) => x.doc?.expiringSoon).length,
        },
      };
    });

    const counts = {
      NEEDS_REVIEW: rows.filter((x) => x.summary.toReview > 0).length,
      MISSING: rows.filter((x) => x.summary.missing > 0).length,
      COMPLETE: rows.filter((x) => x.summary.required > 0 && x.summary.verified === x.summary.required).length,
      ALL: rows.length,
    };
    const filtered = rows.filter((x) =>
      q.filter === 'NEEDS_REVIEW' ? x.summary.toReview > 0 : q.filter === 'MISSING' ? x.summary.missing > 0 : q.filter === 'COMPLETE' ? x.summary.required > 0 && x.summary.verified === x.summary.required : true,
    );
    // Shops with the most waiting first, then the most missing.
    filtered.sort((a, b) => b.summary.toReview - a.summary.toReview || b.summary.missing - a.summary.missing);
    return { counts, stores: filtered };
  }

  // -------------------------------------------------------------------
  // Store controls: notices, partner staff access
  // -------------------------------------------------------------------

  /** A message from Delivez to the store (plan §7 SEND_WARNING). Shown live and on the partner dashboard for 30 days. */
  async sendNotice(storeId: string, message: string, admin: AdminContext, ctx: { ip?: string; correlationId?: string }) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true, cityId: true } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    assertCityScope(admin, store.cityId);
    const action = await this.prisma.$transaction(async (tx) => {
      const a = await tx.adminAction.create({ data: { adminId: admin.adminId, storeId, type: 'SEND_WARNING', reason: message } });
      await this.audit.log({ actorUserId: admin.userId, actorType: 'ADMIN', entity: 'Store', entityId: storeId, action: 'CREATE', after: { notice: message }, ip: ctx.ip }, tx);
      await this.events.publish(tx, {
        type: 'store.admin_notice',
        data: { storeId, noticeId: a.id, message },
        actor: { type: 'ADMIN', userId: admin.userId, role: admin.role },
        correlationId: ctx.correlationId,
      });
      return a;
    });
    return { id: action.id, sentAt: action.createdAt };
  }

  /** Turn a partner member's access on or off (affects every store of that partner account). */
  async setMemberActive(storeId: string, memberId: string, isActive: boolean, reason: string | undefined, admin: AdminContext, ctx: { ip?: string; correlationId?: string }) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { cityId: true, partnerAccountId: true } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    assertCityScope(admin, store.cityId);
    const member = await this.prisma.partnerMember.findFirst({ where: { id: memberId, partnerAccountId: store.partnerAccountId } });
    if (!member) throw new ApiError(HttpStatus.NOT_FOUND, 'MEMBER_NOT_FOUND', 'This person is not part of this partner');
    if (member.isActive === isActive) return { memberId, isActive };
    if (!isActive && member.role === 'OWNER') {
      const owners = await this.prisma.partnerMember.count({ where: { partnerAccountId: store.partnerAccountId, role: 'OWNER', isActive: true } });
      if (owners <= 1) throw new ApiError(HttpStatus.CONFLICT, 'LAST_OWNER', 'This is the only active owner — suspend the store instead');
    }
    await this.prisma.$transaction(async (tx) => {
      // acceptedAt is set so a deactivated invite is not re-activated by the invitee's next login.
      await tx.partnerMember.update({ where: { id: memberId }, data: { isActive, acceptedAt: member.acceptedAt ?? new Date() } });
      await this.audit.log(
        { actorUserId: admin.userId, actorType: 'ADMIN', entity: 'PartnerMember', entityId: memberId, action: 'UPDATE', before: { isActive: member.isActive }, after: { isActive, reason }, ip: ctx.ip },
        tx,
      );
      await this.events.publish(tx, {
        type: 'staff.updated',
        data: { storeId, memberId, isActive },
        actor: { type: 'ADMIN', userId: admin.userId, role: admin.role },
        correlationId: ctx.correlationId,
      });
    });
    return { memberId, isActive };
  }
}

/** Stores an admin may see: all, or only those in their cities. */
function storeScope(admin: AdminContext): Prisma.StoreWhereInput {
  return admin.cityIds.length ? { cityId: { in: admin.cityIds } } : {};
}


function latestStatus(docs: { type: string; status: DocumentStatus }[]) {
  const m = new Map<string, DocumentStatus>();
  for (const d of docs) if (!m.has(d.type)) m.set(d.type, d.status);
  return m;
}
