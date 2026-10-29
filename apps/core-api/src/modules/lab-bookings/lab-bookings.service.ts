import { randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { LabBookingStatus, LabCollectionType, OrderChannel, PaymentMode, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { haversineKm } from '../../common/geo';
import { KvService } from '../../common/kv/kv.service';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { checkLabTransition, PRE_COLLECTION, type LabAction, type LabActor } from './lab-booking-state';

export interface LabActorCtx {
  kind: LabActor;
  userId?: string;
  role?: string;
  ip?: string;
  correlationId?: string;
}

export interface CreateBookingInput {
  storeId: string;
  channel: OrderChannel;
  collectionType: LabCollectionType;
  slotStart: Date;
  customer: { phone: string; name?: string };
  patient: { name: string; age?: number; gender?: 'F' | 'M' | 'O' };
  testIds: string[];
  paymentMode: PaymentMode;
  address?: { line1: string; landmark?: string; pincode: string; lat: number; lng: number };
  note?: string;
  /** Customer-uploaded prescription (file keys under the store's rx prefix). */
  prescriptionFileKeys?: string[];
  /** Store-created bookings: staff confirm they have seen a valid prescription. */
  rxSeenByStore?: boolean;
  /** Store-created bookings start confirmed. */
  startConfirmed?: boolean;
  isTestBooking?: boolean;
}

export type BookingTab = 'TO_CONFIRM' | 'UPCOMING' | 'IN_LAB' | 'REPORTS' | 'CANCELLED' | 'ALL';
export const BOOKING_TABS: Record<Exclude<BookingTab, 'ALL'>, LabBookingStatus[]> = {
  TO_CONFIRM: ['BOOKED', 'RX_REVIEW'],
  UPCOMING: ['CONFIRMED', 'COLLECTOR_ASSIGNED'],
  IN_LAB: ['SAMPLE_COLLECTED', 'PROCESSING'],
  REPORTS: ['REPORT_READY'],
  CANCELLED: ['CANCELLED', 'REJECTED'],
};

const EVENT: Record<LabAction, string> = {
  APPROVE_RX: 'lab.booking_rx_approved',
  REJECT_RX: 'lab.booking_rx_rejected',
  CONFIRM: 'lab.booking_confirmed',
  REJECT: 'lab.booking_rejected',
  ASSIGN_COLLECTOR: 'lab.booking_collector_assigned',
  COLLECT: 'lab.booking_sample_collected',
  START_PROCESSING: 'lab.booking_processing',
  RELEASE_REPORT: 'lab.report_released',
  AMEND_REPORT: 'lab.report_amended',
  CANCEL: 'lab.booking_cancelled',
};
const ERR = { ACTOR_NOT_ALLOWED: HttpStatus.FORBIDDEN, WRONG_COLLECTION_TYPE: HttpStatus.CONFLICT, BOOKING_INVALID_TRANSITION: HttpStatus.CONFLICT, REASON_REQUIRED: HttpStatus.BAD_REQUEST } as const;

/** Health data: links to reports and prescriptions live 5 minutes and every open is logged. */
const HEALTH_URL_TTL = 300;
const SLOT_LEAD_MINUTES = 60;
const DEFAULT_SLOT_CAPACITY = 4;
const CODE_ATTEMPTS = 5;

const INCLUDE = {
  items: true,
  customer: { include: { user: { select: { phone: true, fullName: true } } } },
  prescription: { select: { id: true, status: true, fileUrls: true, doctorName: true, doctorRegNo: true, reviewNotes: true, rejectionReason: true, reviewedAt: true } },
  reports: { orderBy: { version: 'desc' }, include: { pathologist: { select: { name: true, qualification: true, registrationNo: true } } } },
} satisfies Prisma.LabBookingInclude;
type Row = Prisma.LabBookingGetPayload<{ include: typeof INCLUDE }>;

@Injectable()
export class LabBookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    private readonly kv: KvService,
  ) {}

  // ------------------------------------------------------------------
  // Slots
  // ------------------------------------------------------------------

  /** Hourly slots for a day (IST) from the lab's hours; capacity per slot = max bookings per hour (default 4). */
  async slots(storeId: string, date: string, type: LabCollectionType) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, include: { timings: true, holidays: true } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    const offered = type === 'HOME' ? store.supportsDelivery : store.supportsPickup;
    const day = new Date(`${date}T12:00:00+05:30`).getUTCDay();
    const holiday = store.holidays.some((h) => h.date.toISOString().slice(0, 10) === date);
    const capacity = store.maxOrdersPerHour ?? DEFAULT_SLOT_CAPACITY;
    const starts: Date[] = [];
    if (offered && !holiday) {
      for (const t of store.timings.filter((x) => x.dayOfWeek === day && !x.isClosed)) {
        const [oh, om] = t.opensAt.split(':').map(Number);
        const [ch, cm] = t.closesAt.split(':').map(Number);
        for (let h = om > 0 ? oh + 1 : oh; h + 1 <= ch + cm / 60; h++) starts.push(new Date(`${date}T${String(h).padStart(2, '0')}:00:00+05:30`));
      }
    }
    const booked = await this.prisma.labBooking.groupBy({
      by: ['slotStart'],
      where: { storeId, slotStart: { in: starts }, status: { notIn: ['CANCELLED', 'REJECTED'] } },
      _count: { _all: true },
    });
    const earliest = Date.now() + SLOT_LEAD_MINUTES * 60_000;
    return {
      date,
      collectionType: type,
      offered,
      capacity,
      slots: starts.map((s) => {
        const taken = booked.find((b) => b.slotStart.getTime() === s.getTime())?._count._all ?? 0;
        return { start: s, left: Math.max(0, capacity - taken), available: s.getTime() >= earliest && taken < capacity };
      }),
    };
  }

  private async assertSlot(storeId: string, slotStart: Date, type: LabCollectionType, excludeBookingId?: string) {
    const date = new Date(slotStart.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const day = await this.slots(storeId, date, type);
    const slot = day.slots.find((s) => s.start.getTime() === slotStart.getTime());
    if (!slot) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'SLOT_INVALID', 'Pick one of the lab’s hourly slots');
    const own = excludeBookingId ? await this.prisma.labBooking.count({ where: { id: excludeBookingId, slotStart } }) : 0;
    if (slotStart.getTime() < Date.now() + SLOT_LEAD_MINUTES * 60_000) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'SLOT_TOO_SOON', 'Slots must be at least an hour away');
    if (slot.left + own <= 0) throw new ApiError(HttpStatus.CONFLICT, 'SLOT_FULL', 'That slot is full — pick another');
  }

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  async create(input: CreateBookingInput, actor: LabActorCtx) {
    const { id } = await this.prepare(input, actor, false);
    return this.detailById(id!);
  }

  /** Every check a booking goes through, without booking: the price, or the reason it can't be booked (used before taking payment). */
  async check(input: CreateBookingInput) {
    const { grandTotal } = await this.prepare(input, { kind: 'CUSTOMER' }, true);
    return { grandTotal };
  }

  private async prepare(input: CreateBookingInput, actor: LabActorCtx, dryRun: boolean): Promise<{ id?: string; grandTotal: number }> {
    const store = await this.prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store || store.vertical !== 'DIAGNOSTICS') throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Lab not found');
    if (!['LIVE', 'LIMITED'].includes(store.status)) throw new ApiError(HttpStatus.CONFLICT, 'STORE_NOT_LIVE', 'Bookings start once the lab is live');
    if (input.collectionType === 'HOME' && !store.supportsDelivery) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'HOME_NOT_OFFERED', 'This lab does not offer home collection');
    if (input.collectionType === 'WALK_IN' && !store.supportsPickup) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'WALK_IN_NOT_OFFERED', 'This lab does not offer walk-in');

    const tests = await this.prisma.product.findMany({ where: { storeId: store.id, id: { in: input.testIds }, deletedAt: null } });
    if (tests.length !== new Set(input.testIds).size) throw new ApiError(HttpStatus.BAD_REQUEST, 'TEST_NOT_FOUND', 'A test is not offered by this lab');
    const now = new Date();
    for (const t of tests) {
      if (!t.isAvailable || (t.pausedUntil && t.pausedUntil > now)) throw new ApiError(HttpStatus.CONFLICT, 'TEST_UNAVAILABLE', `${t.name} is not available right now`);
      const ok = input.collectionType === 'HOME' ? t.labHomeCollection !== false : t.labWalkIn !== false;
      if (!ok) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'TEST_NOT_FOR_COLLECTION_TYPE', `${t.name} is ${input.collectionType === 'HOME' ? 'walk-in only' : 'home collection only'}`);
    }
    const rxRequired = tests.some((t) => t.prescriptionRequired);
    const storeCreated = !!input.startConfirmed;
    if (rxRequired && storeCreated && !input.rxSeenByStore) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'RX_REQUIRED', 'Confirm you have seen the doctor’s prescription for the Rx tests');
    if (rxRequired && !storeCreated && !input.prescriptionFileKeys?.length) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'RX_REQUIRED', 'Upload the doctor’s prescription to book these tests');

    let distanceKm: number | null = null;
    if (input.collectionType === 'HOME') {
      if (!input.address) throw new ApiError(HttpStatus.BAD_REQUEST, 'ADDRESS_REQUIRED', 'Add the address for sample collection');
      distanceKm = Math.round(haversineKm(store.lat!, store.lng!, input.address.lat, input.address.lng) * 10) / 10;
      if (distanceKm > store.deliveryRadiusKm) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'OUT_OF_RANGE', `This address is ${distanceKm} km away; the lab collects up to ${store.deliveryRadiusKm} km`);
    }
    await this.assertSlot(store.id, input.slotStart, input.collectionType);

    const itemsSubtotal = tests.reduce((s, t) => s + t.price, 0);
    const collectionFee = input.collectionType === 'HOME' ? store.collectionFee : 0;
    const grandTotal = itemsSubtotal + collectionFee;
    const paid = input.paymentMode !== 'COD';
    const status: LabBookingStatus = storeCreated ? 'CONFIRMED' : rxRequired ? 'RX_REVIEW' : 'BOOKED';

    if (dryRun) return { grandTotal };

    const booking = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({ where: { phone: input.customer.phone }, update: {}, create: { phone: input.customer.phone, fullName: input.customer.name ?? null } });
      const customer = await tx.customer.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
      let prescriptionId: string | undefined;
      if (rxRequired && input.prescriptionFileKeys?.length) {
        for (const k of input.prescriptionFileKeys) if (!k.startsWith(`stores/${store.id}/lab-rx/`)) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_KEY_INVALID', 'Upload the prescription for this lab first');
        const hashes = await Promise.all(input.prescriptionFileKeys.map((k) => this.storage.hashOf(k)));
        if (hashes.some((h) => !h)) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_NOT_FOUND', 'Prescription upload not found');
        const rx = await tx.prescription.create({ data: { customerId: customer.id, storeId: store.id, fileUrls: input.prescriptionFileKeys, fileHash: hashes.join(':'), status: 'UNDER_REVIEW', patientName: input.patient.name } });
        prescriptionId = rx.id;
      }
      const b = await tx.labBooking.create({
        data: {
          bookingNumber: await this.newNumber(tx),
          customerId: customer.id,
          storeId: store.id,
          channel: input.channel,
          status,
          collectionType: input.collectionType,
          slotStart: input.slotStart,
          patientName: input.patient.name,
          patientAge: input.patient.age,
          patientGender: input.patient.gender,
          address: input.address ? { ...input.address } : undefined,
          distanceKm,
          itemsSubtotal,
          collectionFee,
          grandTotal,
          paymentMode: input.paymentMode,
          paymentStatus: paid ? 'CAPTURED' : 'COD_PENDING',
          rxRequired,
          prescriptionId,
          rxSeenByStore: !!input.rxSeenByStore,
          collectionOtp: String(randomInt(0, 10_000)).padStart(4, '0'),
          confirmedAt: storeCreated ? now : null,
          customerNote: input.note,
          isTestBooking: !!input.isTestBooking,
          items: {
            create: tests.map((t) => ({ productId: t.id, testName: t.name, unitPrice: t.price, isRx: t.prescriptionRequired, sampleType: t.labSampleType, fastingHours: t.labFastingHours, reportHours: t.labReportHours })),
          },
        },
      });
      await tx.labBookingEvent.create({ data: { bookingId: b.id, toState: status, actorType: actor.kind, actorId: actor.userId, meta: { channel: input.channel } } });
      await this.events.publish(tx, {
        type: 'lab.booking_created',
        data: { storeId: store.id, bookingId: b.id, bookingNumber: b.bookingNumber, status, collectionType: input.collectionType, slotStart: input.slotStart.toISOString(), rxRequired, tests: tests.length },
        actor: { type: actor.kind, userId: actor.userId, role: actor.role },
        correlationId: actor.correlationId,
      });
      return b;
    });
    return { id: booking.id, grandTotal };
  }

  private async newNumber(tx: Prisma.TransactionClient) {
    for (let i = 0; i < 8; i++) {
      const n = `LAB-${randomInt(100000, 1000000)}`;
      if (!(await tx.labBooking.findUnique({ where: { bookingNumber: n }, select: { id: true } }))) return n;
    }
    throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'NUMBER_EXHAUSTED', 'Please try again');
  }

  // ------------------------------------------------------------------
  // Transitions
  // ------------------------------------------------------------------

  async transition(storeId: string | null, bookingId: string, action: LabAction, actor: LabActorCtx, opts: { reason?: string; data?: Prisma.LabBookingUpdateInput; meta?: Record<string, unknown>; before?: (tx: Prisma.TransactionClient, b: Row) => Promise<void> } = {}) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM lab_bookings WHERE id = ${bookingId} FOR UPDATE`;
      const b = await tx.labBooking.findUnique({ where: { id: bookingId }, include: INCLUDE });
      if (!b || (storeId && b.storeId !== storeId)) throw new ApiError(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Booking not found');
      const check = checkLabTransition(action, b, actor.kind, opts.reason);
      if (!check.ok) throw new ApiError(ERR[check.code], check.code, check.message, { status: b.status });
      await opts.before?.(tx, b);

      const now = new Date();
      const data: Prisma.LabBookingUpdateInput = { status: check.to, ...opts.data };
      if (action === 'CONFIRM' || action === 'APPROVE_RX') data.confirmedAt = now;
      if (action === 'COLLECT') Object.assign(data, { collectedAt: now, ...(b.paymentMode === 'COD' ? { paymentStatus: 'COD_COLLECTED' as const } : {}) });
      if (action === 'START_PROCESSING') data.processingAt = now;
      if (action === 'RELEASE_REPORT' || action === 'AMEND_REPORT') data.reportReadyAt = now;
      if (action === 'REJECT' || action === 'REJECT_RX' || action === 'CANCEL') {
        Object.assign(data, { cancelledAt: now, cancelledBy: action === 'CANCEL' ? actor.kind : 'STORE', cancelReason: opts.reason });
        if (b.paymentStatus === 'CAPTURED') {
          Object.assign(data, { paymentStatus: 'REFUND_PENDING' as const, refundAmount: b.grandTotal });
          await this.events.publish(tx, { type: 'lab.refund_initiated', data: { storeId: b.storeId, bookingId, amount: b.grandTotal, reason: opts.reason }, actor: { type: 'SYSTEM' } });
        }
      }
      await tx.labBooking.update({ where: { id: bookingId }, data });
      await tx.labBookingEvent.create({ data: { bookingId, fromState: b.status, toState: check.to, actorType: actor.kind, actorId: actor.userId, reason: opts.reason ?? null, meta: (opts.meta ?? undefined) as Prisma.InputJsonValue | undefined } });
      await this.events.publish(tx, {
        type: EVENT[action],
        data: { storeId: b.storeId, bookingId, bookingNumber: b.bookingNumber, from: b.status, to: check.to, reason: opts.reason, ...(opts.meta ?? {}) },
        actor: { type: actor.kind, userId: actor.userId, role: actor.role },
        correlationId: actor.correlationId,
      });
    });
    return this.detailById(bookingId);
  }

  approveRx(storeId: string, id: string, input: { doctorName?: string; doctorRegNo?: string; notes?: string }, actor: LabActorCtx) {
    return this.transition(storeId, id, 'APPROVE_RX', actor, {
      before: async (tx, b) => {
        if (b.prescriptionId) {
          await tx.prescription.update({ where: { id: b.prescriptionId }, data: { status: 'APPROVED', doctorName: input.doctorName, doctorRegNo: input.doctorRegNo, reviewNotes: input.notes, reviewedAt: new Date() } });
        }
      },
      meta: { doctorName: input.doctorName },
    });
  }

  rejectRx(storeId: string, id: string, reason: string, actor: LabActorCtx) {
    return this.transition(storeId, id, 'REJECT_RX', actor, {
      reason,
      before: async (tx, b) => {
        if (b.prescriptionId) await tx.prescription.update({ where: { id: b.prescriptionId }, data: { status: 'REJECTED', rejectionReason: reason, reviewedAt: new Date() } });
      },
    });
  }

  assignCollector(storeId: string, id: string, c: { name: string; phone: string }, actor: LabActorCtx) {
    return this.transition(storeId, id, 'ASSIGN_COLLECTOR', actor, { data: { collectorName: c.name, collectorPhone: c.phone, collectorAssignedAt: new Date() }, meta: { collector: c.name } });
  }

  /** The collector (home) or front desk (walk-in) checks the customer's booking code before drawing the sample. */
  async collect(storeId: string, id: string, code: string, actor: LabActorCtx) {
    const b = await this.prisma.labBooking.findUnique({ where: { id } });
    if (!b || b.storeId !== storeId) throw new ApiError(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Booking not found');
    const check = checkLabTransition('COLLECT', b, actor.kind);
    if (!check.ok) throw new ApiError(ERR[check.code], check.code, b.collectionType === 'HOME' && b.status === 'CONFIRMED' ? 'Assign a collector first' : check.message, { status: b.status });
    const key = `otp:lab:${id}`;
    if (Number((await this.kv.get(key)) ?? 0) >= CODE_ATTEMPTS) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong codes. Contact Delivez support.');
    const a = Buffer.from(code.trim());
    const e = Buffer.from(b.collectionOtp);
    if (a.length !== e.length || !timingSafeEqual(a, e)) {
      const n = await this.kv.incr(key, 600);
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'OTP_INCORRECT', 'Wrong booking code — ask the patient to check their app', { attemptsLeft: Math.max(0, CODE_ATTEMPTS - n) });
    }
    return this.transition(storeId, id, 'COLLECT', actor);
  }

  async reschedule(storeId: string | null, id: string, slotStart: Date, actor: LabActorCtx) {
    const b = await this.prisma.labBooking.findUnique({ where: { id } });
    if (!b || (storeId && b.storeId !== storeId)) throw new ApiError(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (!PRE_COLLECTION.includes(b.status)) throw new ApiError(HttpStatus.CONFLICT, 'BOOKING_INVALID_TRANSITION', 'Only bookings before sample collection can be rescheduled');
    await this.assertSlot(b.storeId, slotStart, b.collectionType, b.id);
    await this.prisma.$transaction(async (tx) => {
      await tx.labBooking.update({ where: { id }, data: { slotStart } });
      await tx.labBookingEvent.create({ data: { bookingId: id, fromState: b.status, toState: b.status, actorType: actor.kind, actorId: actor.userId, reason: 'Rescheduled', meta: { from: b.slotStart, to: slotStart } } });
      await this.events.publish(tx, { type: 'lab.booking_rescheduled', data: { storeId: b.storeId, bookingId: id, bookingNumber: b.bookingNumber, from: b.slotStart.toISOString(), to: slotStart.toISOString() }, actor: { type: actor.kind, userId: actor.userId } });
    });
    return this.detailById(id);
  }

  pathologists(storeId: string) {
    return this.prisma.pathologist.findMany({ where: { storeId, isActive: true, consentAt: { not: null } }, select: { id: true, name: true, qualification: true, registrationNo: true } });
  }

  // ------------------------------------------------------------------
  // Reports (pathologist-signed PDF, versioned)
  // ------------------------------------------------------------------

  reportUpload(storeId: string, size: number) {
    return this.storage.presignUpload(`stores/${storeId}/lab-reports`, 'application/pdf', size);
  }

  rxUpload(storeId: string, contentType: string, size: number) {
    return this.storage.presignUpload(`stores/${storeId}/lab-rx`, contentType, size);
  }

  async releaseReport(storeId: string, id: string, input: { fileKey: string; pathologistId: string; summary?: string; amendReason?: string }, actor: LabActorCtx) {
    if (!input.fileKey.startsWith(`stores/${storeId}/lab-reports/`) || !input.fileKey.endsWith('.pdf')) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_KEY_INVALID', 'Upload the report PDF first');
    const hash = await this.storage.hashOf(input.fileKey);
    if (!hash) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_NOT_FOUND', 'Report upload not found');
    const pathologist = await this.prisma.pathologist.findFirst({ where: { id: input.pathologistId, storeId, isActive: true, consentAt: { not: null } } });
    if (!pathologist) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'PATHOLOGIST_INVALID', 'Choose the lab’s registered pathologist who signed this report');
    const current = await this.prisma.labBooking.findUnique({ where: { id }, select: { status: true } });
    const amend = current?.status === 'REPORT_READY';
    return this.transition(storeId, id, amend ? 'AMEND_REPORT' : 'RELEASE_REPORT', actor, {
      reason: amend ? input.amendReason : undefined,
      before: async (tx, b) => {
        const last = b.reports[0];
        if (last) await tx.labReport.update({ where: { id: last.id }, data: { supersededAt: new Date() } });
        await tx.labReport.create({
          data: { bookingId: id, version: (last?.version ?? 0) + 1, fileKey: input.fileKey, fileHash: hash, pathologistId: pathologist.id, releasedById: actor.userId!, summary: input.summary, amendReason: amend ? input.amendReason : null },
        });
      },
      meta: { pathologist: pathologist.name },
    });
  }

  /** A short-lived link to a report; the open is logged (who, when, why). */
  async reportFile(bookingId: string, reportId: string, actor: LabActorCtx, purpose: string | undefined, storeId: string | null) {
    const report = await this.prisma.labReport.findUnique({ where: { id: reportId }, include: { booking: { select: { storeId: true, id: true } } } });
    if (!report || report.booking.id !== bookingId || (storeId && report.booking.storeId !== storeId)) throw new ApiError(HttpStatus.NOT_FOUND, 'REPORT_NOT_FOUND', 'Report not found');
    await this.prisma.labReportAccess.create({ data: { reportId, userId: actor.userId, actorType: actor.kind, purpose, ip: actor.ip } });
    return { url: this.storage.signedReadUrl(report.fileKey, HEALTH_URL_TTL), expiresIn: HEALTH_URL_TTL, version: report.version, superseded: !!report.supersededAt };
  }

  /** The uploaded prescription — logged in the audit trail. */
  async prescriptionFile(storeId: string | null, bookingId: string, actor: LabActorCtx, purpose?: string) {
    const b = await this.prisma.labBooking.findUnique({ where: { id: bookingId }, include: { prescription: true } });
    if (!b || (storeId && b.storeId !== storeId)) throw new ApiError(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Booking not found');
    if (!b.prescription) throw new ApiError(HttpStatus.NOT_FOUND, 'NO_PRESCRIPTION', 'No prescription was uploaded for this booking');
    await this.audit.log({ actorUserId: actor.userId, actorType: actor.kind === 'ADMIN' ? 'ADMIN' : 'USER', entity: 'Prescription', entityId: b.prescription.id, action: 'UPDATE', after: { viewed: true, bookingId, purpose }, ip: actor.ip });
    return { files: b.prescription.fileUrls.map((k) => ({ url: this.storage.signedReadUrl(k, HEALTH_URL_TTL), contentType: k.endsWith('.pdf') ? 'application/pdf' : 'image' })), expiresIn: HEALTH_URL_TTL };
  }

  async reportAccessLog(storeId: string | null, bookingId: string) {
    const b = await this.prisma.labBooking.findUnique({ where: { id: bookingId }, select: { storeId: true } });
    if (!b || (storeId && b.storeId !== storeId)) throw new ApiError(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Booking not found');
    const rows = await this.prisma.labReportAccess.findMany({ where: { report: { bookingId } }, orderBy: { createdAt: 'desc' }, take: 100, include: { report: { select: { version: true } } } });
    const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter(Boolean) as string[] } }, select: { id: true, fullName: true, phone: true } });
    return rows.map((r) => ({ version: r.report.version, actorType: r.actorType, who: users.find((u) => u.id === r.userId)?.fullName ?? null, purpose: r.purpose, ip: r.ip, at: r.createdAt }));
  }

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------

  async list(storeId: string, tab: BookingTab, date?: string) {
    const states = tab === 'ALL' ? undefined : BOOKING_TABS[tab];
    const day = date ? { gte: new Date(`${date}T00:00:00+05:30`), lt: new Date(`${date}T24:00:00+05:30`) } : undefined;
    const rows = await this.prisma.labBooking.findMany({
      where: { storeId, ...(states ? { status: { in: states } } : {}), ...(day ? { slotStart: day } : {}) },
      include: INCLUDE,
      orderBy: tab === 'REPORTS' || tab === 'CANCELLED' || tab === 'ALL' ? { slotStart: 'desc' } : { slotStart: 'asc' },
      take: 200,
    });
    const grouped = await this.prisma.labBooking.groupBy({ by: ['status'], where: { storeId, status: { notIn: ['CANCELLED', 'REJECTED', 'REPORT_READY'] } }, _count: { _all: true } });
    const count = (s: LabBookingStatus[]) => grouped.filter((g) => s.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
    return { bookings: rows.map((b) => this.view(b)), counts: { TO_CONFIRM: count(BOOKING_TABS.TO_CONFIRM), UPCOMING: count(BOOKING_TABS.UPCOMING), IN_LAB: count(BOOKING_TABS.IN_LAB) } };
  }

  async detail(storeId: string, idOrNumber: string) {
    const where = /^LAB-\d+$/i.test(idOrNumber) ? { bookingNumber: idOrNumber.toUpperCase() } : { id: idOrNumber };
    const b = await this.prisma.labBooking.findFirst({ where: { ...where, storeId }, select: { id: true } });
    if (!b) throw new ApiError(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Booking not found');
    return this.detailById(b.id);
  }

  async detailById(id: string) {
    const b = await this.prisma.labBooking.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    const events = await this.prisma.labBookingEvent.findMany({ where: { bookingId: id }, orderBy: { createdAt: 'asc' } });
    return { ...this.view(b), timeline: events.map((e) => ({ from: e.fromState, to: e.toState, actorType: e.actorType, reason: e.reason, meta: e.meta, at: e.createdAt })) };
  }

  /** Lab staff view. The booking code is never sent to the lab — the patient reads it out. */
  view(b: Row) {
    const phone = b.customer.user.phone;
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: b.status,
      channel: b.channel,
      collectionType: b.collectionType,
      slotStart: b.slotStart,
      slotMinutes: b.slotMinutes,
      isTestBooking: b.isTestBooking,
      patient: { name: b.patientName, age: b.patientAge, gender: b.patientGender },
      customerPhone: phone.length >= 10 ? `${phone.slice(-10, -5)} •••${phone.slice(-2)}` : phone,
      address: b.address,
      distanceKm: b.distanceKm,
      note: b.customerNote,
      tests: b.items.map((i) => ({ id: i.id, name: i.testName, price: i.unitPrice, isRx: i.isRx, sampleType: i.sampleType, fastingHours: i.fastingHours, reportHours: i.reportHours })),
      fastingHours: Math.max(0, ...b.items.map((i) => i.fastingHours ?? 0)),
      totals: { tests: b.itemsSubtotal, collectionFee: b.collectionFee, grandTotal: b.grandTotal, refund: b.refundAmount },
      payment: { mode: b.paymentMode, status: b.paymentStatus, collectCash: b.paymentMode === 'COD' && b.paymentStatus === 'COD_PENDING' ? b.grandTotal : 0 },
      rx: b.rxRequired
        ? { required: true, seenByStore: b.rxSeenByStore, prescription: b.prescription ? { id: b.prescription.id, status: b.prescription.status, files: b.prescription.fileUrls.length, doctorName: b.prescription.doctorName, doctorRegNo: b.prescription.doctorRegNo, notes: b.prescription.reviewNotes, rejectionReason: b.prescription.rejectionReason } : null }
        : null,
      collector: b.collectorName ? { name: b.collectorName, phone: b.collectorPhone, assignedAt: b.collectorAssignedAt } : null,
      reports: b.reports.map((r) => ({ id: r.id, version: r.version, summary: r.summary, amendReason: r.amendReason, pathologist: r.pathologist, superseded: !!r.supersededAt, releasedAt: r.createdAt })),
      times: { bookedAt: b.createdAt, confirmedAt: b.confirmedAt, collectedAt: b.collectedAt, processingAt: b.processingAt, reportReadyAt: b.reportReadyAt, cancelledAt: b.cancelledAt },
      cancelReason: b.cancelReason,
    };
  }

  // ------------------------------------------------------------------
  // Admin
  // ------------------------------------------------------------------

  async adminList(q: { storeId?: string; status?: string; q?: string; limit: number }) {
    const rows = await this.prisma.labBooking.findMany({
      where: { ...(q.storeId ? { storeId: q.storeId } : {}), ...(q.status ? { status: q.status as LabBookingStatus } : {}), ...(q.q ? { bookingNumber: { contains: q.q.toUpperCase() } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: q.limit,
      include: { store: { select: { id: true, name: true } } },
    });
    return rows.map((b) => ({ id: b.id, bookingNumber: b.bookingNumber, status: b.status, collectionType: b.collectionType, slotStart: b.slotStart, grandTotal: b.grandTotal, rxRequired: b.rxRequired, isTestBooking: b.isTestBooking, store: b.store }));
  }

  async adminDetail(id: string) {
    const b = await this.prisma.labBooking.findUnique({ where: { id }, include: { store: { select: { id: true, name: true } } } });
    if (!b) throw new ApiError(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Booking not found');
    return { ...(await this.detailById(id)), store: b.store, codes: process.env.NODE_ENV !== 'production' ? { collectionOtp: b.collectionOtp } : undefined };
  }
}

