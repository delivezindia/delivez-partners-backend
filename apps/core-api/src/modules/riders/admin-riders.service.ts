import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma, RiderApplicationStatus } from '@delivez/db';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { StorageService } from '../files/storage.service';
import { AuthService } from '../identity/auth.service';
import type { AdminContext } from '../admin/admin.guard';
import { missingItems } from './rider-registration.service';
import type { VehicleType } from './rider-options';

const IN_REVIEW: RiderApplicationStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];
const BUSY = ['ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'WAITING_AT_PICKUP', 'PICKED_UP', 'EN_ROUTE_TO_DROP', 'ARRIVED_AT_DROP'] as const;

const include = {
  rider: {
    select: {
      id: true,
      riderCode: true,
      status: true,
      cityId: true,
      suspendedAt: true,
      suspendReason: true,
      user: { select: { id: true, phone: true, fullName: true } },
      documents: { orderBy: { type: 'asc' as const } },
    },
  },
} satisfies Prisma.RiderApplicationInclude;
type Full = Prisma.RiderApplicationGetPayload<{ include: typeof include }>;

/** Rider sign-ups for ops (admin console / hub management): review, approve, suspend. */
@Injectable()
export class AdminRidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** City-scoped admins see applications of their cities (and ones whose pincode is in no city yet). */
  private scope(admin: AdminContext): Prisma.RiderApplicationWhereInput {
    return admin.cityIds.length ? { OR: [{ cityId: { in: admin.cityIds } }, { cityId: null }] } : {};
  }

  async list(admin: AdminContext, q: { status?: RiderApplicationStatus; search?: string; page: number; pageSize: number }) {
    const s = q.search?.trim();
    const where: Prisma.RiderApplicationWhereInput = {
      AND: [
        this.scope(admin),
        q.status ? { status: q.status } : { status: { not: 'DRAFT' } },
        s
          ? {
              OR: [
                { rider: { riderCode: { contains: s, mode: 'insensitive' } } },
                { rider: { user: { phone: { contains: s.replace(/\D/g, '') || s } } } },
                { personalInfo: { path: ['fullName'], string_contains: s } },
              ],
            }
          : {},
      ],
    };
    const [total, rows, counts] = await Promise.all([
      this.prisma.riderApplication.count({ where }),
      this.prisma.riderApplication.findMany({ where, include, orderBy: [{ submittedAt: 'asc' }, { createdAt: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.prisma.riderApplication.groupBy({ by: ['status'], where: this.scope(admin), _count: true }),
    ]);
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
      items: rows.map((a) => {
        const p = (a.personalInfo ?? {}) as { fullName?: string; pincode?: string };
        const v = (a.legalVehicle ?? {}) as { vehicleType?: string; vehicleRegistration?: string };
        return {
          id: a.id,
          riderId: a.rider.id,
          riderCode: a.rider.riderCode,
          riderStatus: a.rider.status,
          status: a.status,
          name: p.fullName ?? a.rider.user.fullName,
          phone: a.rider.user.phone,
          pincode: p.pincode ?? null,
          cityId: a.cityId,
          vehicleType: v.vehicleType ?? null,
          vehicleRegistration: v.vehicleRegistration ?? null,
          documents: { total: a.rider.documents.length, verified: a.rider.documents.filter((d) => d.status === 'VERIFIED').length, rejected: a.rider.documents.filter((d) => d.status === 'REJECTED').length },
          submittedAt: a.submittedAt,
        };
      }),
    };
  }

  async get(admin: AdminContext, id: string) {
    return this.view(await this.load(admin, id));
  }

  async startReview(admin: AdminContext, id: string) {
    const a = await this.load(admin, id);
    if (a.status !== 'SUBMITTED') throw this.wrongState(a.status, 'start a review');
    return this.move(admin, a, 'UNDER_REVIEW', {});
  }

  async verifyDocument(admin: AdminContext, id: string, docId: string) {
    const a = await this.reviewable(admin, id);
    const d = this.doc(a, docId);
    await this.prisma.riderDocument.update({ where: { id: d.id }, data: { status: 'VERIFIED', rejectReason: null, reviewedById: admin.adminId, reviewedAt: new Date() } });
    await this.audit.log({ actorUserId: admin.userId, actorType: 'ADMIN', entity: 'RiderDocument', entityId: d.id, action: 'STATUS_CHANGE', before: { status: d.status }, after: { status: 'VERIFIED' } });
    return this.get(admin, id);
  }

  async rejectDocument(admin: AdminContext, id: string, docId: string, reason: string) {
    const a = await this.reviewable(admin, id);
    const d = this.doc(a, docId);
    await this.prisma.riderDocument.update({ where: { id: d.id }, data: { status: 'REJECTED', rejectReason: reason, reviewedById: admin.adminId, reviewedAt: new Date() } });
    await this.audit.log({ actorUserId: admin.userId, actorType: 'ADMIN', entity: 'RiderDocument', entityId: d.id, action: 'STATUS_CHANGE', before: { status: d.status }, after: { status: 'REJECTED', reason } });
    return this.get(admin, id);
  }

  /** Approves the rider: they can log in to the app's home and go online. Every required file must be verified. */
  async approve(admin: AdminContext, id: string, cityId?: string) {
    const a = await this.reviewable(admin, id);
    const { requiredDocuments } = missingItems(a, a.rider.documents);
    const unverified = requiredDocuments.filter((t) => !a.rider.documents.some((d) => d.type === t && d.status === 'VERIFIED'));
    if (unverified.length) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'DOCUMENTS_NOT_VERIFIED', 'Verify every required document before approving', { unverified });
    const city = cityId ?? a.cityId;
    if (!city) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'CITY_REQUIRED', 'Choose the city this rider will work in');
    if (admin.cityIds.length && !admin.cityIds.includes(city)) throw new ApiError(HttpStatus.FORBIDDEN, 'CITY_NOT_ALLOWED', 'This city is outside your area');
    const exists = await this.prisma.city.findFirst({ where: { id: city, isActive: true }, select: { id: true } });
    if (!exists) throw new ApiError(HttpStatus.BAD_REQUEST, 'CITY_NOT_FOUND', 'Unknown or inactive city');
    const p = a.personalInfo as { fullName: string };
    const v = a.legalVehicle as { vehicleType: VehicleType };
    return this.move(admin, a, 'APPROVED', { cityId: city, reviewNote: null }, async (tx) => {
      await tx.rider.update({ where: { id: a.rider.id }, data: { status: 'ACTIVE', isOnline: false, cityId: city, vehicleType: v.vehicleType } });
      await tx.user.update({ where: { id: a.rider.user.id }, data: { fullName: p.fullName } });
    });
  }

  async requestChanges(admin: AdminContext, id: string, reason: string) {
    const a = await this.reviewable(admin, id);
    return this.move(admin, a, 'CHANGES_REQUESTED', { reviewNote: reason });
  }

  async reject(admin: AdminContext, id: string, reason: string) {
    const a = await this.reviewable(admin, id);
    return this.move(admin, a, 'REJECTED', { reviewNote: reason });
  }

  /** Stops the rider: no new work, every app session ends, the app shows "Account restricted". */
  async suspend(admin: AdminContext, riderId: string, reason: string, ip?: string) {
    const r = await this.rider(admin, riderId);
    if (r.status === 'SUSPENDED') throw new ApiError(HttpStatus.CONFLICT, 'ALREADY_SUSPENDED', 'This rider is already suspended');
    const busy = await this.prisma.deliveryTask.count({ where: { riderId, status: { in: [...BUSY] } } });
    if (busy) throw new ApiError(HttpStatus.CONFLICT, 'RIDER_HAS_ACTIVE_TASK', 'This rider is on a delivery. Reassign it first, then suspend.', { activeTasks: busy });
    await this.prisma.rider.update({ where: { id: riderId }, data: { status: 'SUSPENDED', isOnline: false, suspendedAt: new Date(), suspendReason: reason } });
    const sessions = await this.auth.revokeAll(r.userId, 'RIDER', { actorUserId: admin.userId, actorType: 'ADMIN', ip });
    await this.audit.log({ actorUserId: admin.userId, actorType: 'ADMIN', entity: 'Rider', entityId: riderId, action: 'STATUS_CHANGE', before: { status: r.status }, after: { status: 'SUSPENDED', reason, sessionsEnded: sessions }, ip });
    return { riderId, status: 'SUSPENDED', sessionsEnded: sessions };
  }

  async reinstate(admin: AdminContext, riderId: string, ip?: string) {
    const r = await this.rider(admin, riderId);
    if (r.status !== 'SUSPENDED') throw new ApiError(HttpStatus.CONFLICT, 'NOT_SUSPENDED', 'This rider is not suspended');
    const next = r.application?.status === 'APPROVED' ? 'ACTIVE' : 'ONBOARDING';
    await this.prisma.rider.update({ where: { id: riderId }, data: { status: next, suspendedAt: null, suspendReason: null } });
    await this.audit.log({ actorUserId: admin.userId, actorType: 'ADMIN', entity: 'Rider', entityId: riderId, action: 'STATUS_CHANGE', before: { status: 'SUSPENDED' }, after: { status: next }, ip });
    return { riderId, status: next };
  }

  // ───────── helpers ─────────

  private async load(admin: AdminContext, id: string): Promise<Full> {
    const a = await this.prisma.riderApplication.findFirst({ where: { id, ...this.scope(admin) }, include });
    if (!a) throw new ApiError(HttpStatus.NOT_FOUND, 'APPLICATION_NOT_FOUND', 'Application not found');
    return a;
  }

  private async reviewable(admin: AdminContext, id: string) {
    const a = await this.load(admin, id);
    if (!IN_REVIEW.includes(a.status)) throw this.wrongState(a.status, 'review it');
    if (a.rider.status === 'SUSPENDED') throw new ApiError(HttpStatus.CONFLICT, 'RIDER_SUSPENDED', 'Reinstate this rider before reviewing');
    return a;
  }

  private async rider(admin: AdminContext, riderId: string) {
    const r = await this.prisma.rider.findUnique({ where: { id: riderId }, include: { application: { select: { status: true, cityId: true } } } });
    const city = r?.cityId ?? r?.application?.cityId ?? null;
    if (!r || (admin.cityIds.length && city && !admin.cityIds.includes(city))) throw new ApiError(HttpStatus.NOT_FOUND, 'RIDER_NOT_FOUND', 'Rider not found');
    return r;
  }

  private doc(a: Full, docId: string) {
    const d = a.rider.documents.find((x) => x.id === docId);
    if (!d) throw new ApiError(HttpStatus.NOT_FOUND, 'DOCUMENT_NOT_FOUND', 'Document not found');
    return d;
  }

  private wrongState(status: string, what: string) {
    return new ApiError(HttpStatus.CONFLICT, 'WRONG_STATUS', `Can't ${what}: the application is ${status.toLowerCase().replace('_', ' ')}`);
  }

  /** Status change with a guard on the current status, so two reviewers can't both act. */
  private async move(admin: AdminContext, a: Full, to: RiderApplicationStatus, data: Prisma.RiderApplicationUpdateManyMutationInput, extra?: (tx: Prisma.TransactionClient) => Promise<void>) {
    await this.prisma.$transaction(async (tx) => {
      const r = await tx.riderApplication.updateMany({ where: { id: a.id, status: a.status }, data: { ...data, status: to, reviewedById: admin.adminId, reviewedAt: new Date() } });
      if (!r.count) throw new ApiError(HttpStatus.CONFLICT, 'APPLICATION_CHANGED', 'Someone else just changed this application. Reload it.');
      await extra?.(tx);
      await this.audit.log(
        { actorUserId: admin.userId, actorType: 'ADMIN', entity: 'RiderApplication', entityId: a.id, action: 'STATUS_CHANGE', before: { status: a.status }, after: { status: to, ...(data.reviewNote ? { note: data.reviewNote } : {}) } },
        tx,
      );
    });
    return this.get(admin, a.id);
  }

  private view(a: Full) {
    return {
      id: a.id,
      status: a.status,
      cityId: a.cityId,
      reviewNote: a.reviewNote,
      submittedAt: a.submittedAt,
      reviewedAt: a.reviewedAt,
      rider: { id: a.rider.id, riderCode: a.rider.riderCode, status: a.rider.status, cityId: a.rider.cityId, suspendedAt: a.rider.suspendedAt, suspendReason: a.rider.suspendReason },
      user: a.rider.user,
      steps: {
        'personal-info': a.personalInfo,
        'legal-vehicle': a.legalVehicle,
        'work-tech': a.workTech,
        hyperlocal: a.hyperlocal,
        'training-role': a.trainingRole,
        'safety-compliance': a.safetyCompliance,
      },
      documents: a.rider.documents.map((d) => ({ id: d.id, type: d.type, status: d.status, rejectReason: d.rejectReason, reviewedAt: d.reviewedAt, uploadedAt: d.updatedAt, url: this.storage.signedReadUrl(d.fileKey) })),
      missing: missingItems(a, a.rider.documents),
    };
  }
}
