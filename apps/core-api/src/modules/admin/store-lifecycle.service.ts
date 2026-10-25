import { HttpStatus, Injectable } from '@nestjs/common';
import type { AdminActionType, OnboardingStatus, Prisma, StoreStatus } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { requiredDocuments } from '../onboarding/flows';
import { OnboardingService } from '../onboarding/onboarding.service';
import { docLabel } from '../onboarding/readiness';
import type { AdminContext } from './admin.guard';

export type LifecycleAction = 'START_REVIEW' | 'APPROVE_LIVE' | 'APPROVE_LIMITED' | 'REQUEST_CHANGES' | 'REJECT' | 'SUSPEND' | 'REINSTATE' | 'PAUSE' | 'RESUME';

interface Transition {
  from: StoreStatus[];
  to: StoreStatus;
  session?: OnboardingStatus;
  adminAction?: AdminActionType;
  needsReason: boolean;
}

// Store lifecycle (plan §10.2). Only this service writes stores.status after submission.
const TRANSITIONS: Record<LifecycleAction, Transition> = {
  START_REVIEW: { from: ['SUBMITTED'], to: 'UNDER_REVIEW', needsReason: false },
  APPROVE_LIVE: { from: ['SUBMITTED', 'UNDER_REVIEW', 'LIMITED'], to: 'LIVE', session: 'APPROVED', adminAction: 'APPROVE_STORE', needsReason: false },
  APPROVE_LIMITED: { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'LIMITED', session: 'APPROVED', adminAction: 'APPROVE_STORE', needsReason: false },
  REQUEST_CHANGES: { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'DRAFT', session: 'NEEDS_CHANGES', needsReason: true },
  REJECT: { from: ['SUBMITTED', 'UNDER_REVIEW'], to: 'REJECTED', session: 'REJECTED', adminAction: 'REJECT_STORE', needsReason: true },
  SUSPEND: { from: ['LIVE', 'LIMITED', 'PAUSED'], to: 'SUSPENDED', adminAction: 'SUSPEND_STORE', needsReason: true },
  REINSTATE: { from: ['SUSPENDED'], to: 'LIVE', needsReason: true },
  // Operational pause (no compliance issue): stops new orders until ops resumes it.
  PAUSE: { from: ['LIVE', 'LIMITED'], to: 'PAUSED', adminAction: 'PAUSE_NEW_ORDERS', needsReason: true },
  RESUME: { from: ['PAUSED'], to: 'LIVE', adminAction: 'RESUME_ORDERS', needsReason: false },
};

@Injectable()
export class StoreLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly onboarding: OnboardingService,
  ) {}

  /** Problems that block an approval; empty when the store may go to `target`. */
  async approvalProblems(storeId: string, target: 'LIVE' | 'LIMITED'): Promise<string[]> {
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      include: { documents: { orderBy: { createdAt: 'desc' } }, pharmacists: true, pathologists: true },
    });
    const readiness = await this.onboarding.refreshReadiness(storeId);
    const problems: string[] = [];
    const latest = new Map<string, string>();
    for (const d of store.documents) if (!latest.has(d.type)) latest.set(d.type, d.status);
    const required = requiredDocuments(store.storeType);

    if (!store.cityId || store.lat == null || !store.addressLine1) problems.push('Store location is incomplete');
    if (target === 'LIVE') {
      if (!readiness) problems.push('This store has no onboarding record');
      else if (readiness.score < 80) problems.push(`Readiness is ${readiness.score}; 80 is needed to go LIVE`);
      const unverified = required.filter((t) => latest.get(t) !== 'VERIFIED');
      if (unverified.length) problems.push(`Verify ${unverified.map(docLabel).join(', ')}`);
    } else {
      if (store.vertical === 'PHARMACY') problems.push('Pharmacies cannot soft-launch; verify licences and approve as LIVE');
      if (store.vertical === 'DIAGNOSTICS') problems.push('Labs cannot soft-launch; verify NABL and registrations and approve as LIVE');
      if (!readiness) problems.push('This store has no onboarding record');
      else if (readiness.score < 60) problems.push(`Readiness is ${readiness.score}; 60 is needed for LIMITED`);
      const missing = required.filter((t) => !latest.has(t) || ['REJECTED', 'EXPIRED'].includes(latest.get(t)!));
      if (missing.length) problems.push(`Partner must upload ${missing.map(docLabel).join(', ')}`);
    }
    if (store.vertical === 'PHARMACY' && !store.pharmacists.some((p) => p.isActive && p.consentAt)) {
      problems.push('No active registered pharmacist');
    }
    if (store.vertical === 'DIAGNOSTICS' && !store.pathologists.some((p) => p.isActive && p.consentAt)) {
      problems.push('No active pathologist to sign reports');
    }
    return problems;
  }

  async transition(storeId: string, action: LifecycleAction, admin: AdminContext, opts: { reason?: string; ip?: string; correlationId?: string } = {}) {
    const rule = TRANSITIONS[action];
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, include: { onboarding: true } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    assertCityScope(admin, store.cityId);

    if (!rule.from.includes(store.status)) {
      throw new ApiError(HttpStatus.CONFLICT, 'STORE_INVALID_TRANSITION', `A ${store.status} store cannot be moved this way`, { status: store.status });
    }
    const reason = opts.reason?.trim();
    if (rule.needsReason && (!reason || reason.length < 5)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'REASON_REQUIRED', 'Add a reason (at least 5 characters) — the partner will see it');
    }

    // Reinstating goes back to LIVE only if the store would still pass the LIVE checks.
    let target = rule.to;
    if ((action === 'REINSTATE' || action === 'RESUME') && (await this.approvalProblems(storeId, 'LIVE')).length) target = 'LIMITED';
    if (action === 'APPROVE_LIVE' || action === 'APPROVE_LIMITED') {
      const problems = await this.approvalProblems(storeId, action === 'APPROVE_LIVE' ? 'LIVE' : 'LIMITED');
      if (problems.length) {
        throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'APPROVAL_BLOCKED', 'This store is not ready for that yet', { problems });
      }
    }

    await this.prisma.$transaction(async (tx) => {
      const data: Prisma.StoreUpdateInput = { status: target };
      if (target === 'LIVE' || target === 'LIMITED') {
        if (!store.liveAt) data.liveAt = new Date();
        data.rejectedReason = null;
      }
      if (target === 'REJECTED') data.rejectedReason = reason;
      if (target === 'SUSPENDED' || target === 'REJECTED' || target === 'DRAFT' || target === 'PAUSED') {
        data.openState = 'CLOSED';
        data.closedReason = reason ?? null;
      }
      await tx.store.update({ where: { id: storeId }, data });

      if (store.onboarding && rule.session) {
        await tx.onboardingSession.update({
          where: { id: store.onboarding.id },
          data: {
            status: rule.session,
            completedAt: rule.session === 'APPROVED' ? new Date() : undefined,
            currentStep: rule.session === 'NEEDS_CHANGES' ? 'REVIEW' : undefined,
          },
        });
      }
      if (store.onboarding) {
        await tx.onboardingEvent.create({
          data: { sessionId: store.onboarding.id, step: 'REVIEW', action, actorType: 'ADMIN', meta: { reason, from: store.status, to: target, adminId: admin.adminId } },
        });
      }
      if (rule.adminAction) {
        await tx.adminAction.create({
          data: { adminId: admin.adminId, storeId, type: rule.adminAction, params: { from: store.status, to: target }, reason },
        });
      }
      await this.audit.log(
        { actorUserId: admin.userId, actorType: 'ADMIN', entity: 'Store', entityId: storeId, action: 'STATUS_CHANGE', before: { status: store.status }, after: { status: target, reason }, ip: opts.ip },
        tx,
      );
      await this.events.publish(tx, {
        type: 'store.status_changed',
        data: { storeId, from: store.status, to: target, reason, action },
        actor: { type: 'ADMIN', userId: admin.userId, role: admin.role },
        correlationId: opts.correlationId,
      });
      if (rule.session === 'APPROVED') {
        await this.events.publish(tx, {
          type: 'onboarding.approved',
          data: { storeId, status: target },
          actor: { type: 'ADMIN', userId: admin.userId, role: admin.role },
          correlationId: opts.correlationId,
        });
      }
    });

    return { storeId, from: store.status, to: target };
  }
}

export function assertCityScope(admin: AdminContext, cityId: string | null) {
  if (admin.cityIds.length && (!cityId || !admin.cityIds.includes(cityId))) {
    throw new ApiError(HttpStatus.FORBIDDEN, 'CITY_OUT_OF_SCOPE', 'This store is outside your cities');
  }
}
