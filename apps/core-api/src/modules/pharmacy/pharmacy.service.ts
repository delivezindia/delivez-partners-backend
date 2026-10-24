import { HttpStatus, Injectable } from '@nestjs/common';
import type { PartnerRole, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { OrderStateService, type OrderActor } from '../orders/order-state.service';
import { maskPhone, OrdersService } from '../orders/orders.service';
import { dutyState, endOfIstDay, shiftProblem, type Shift } from './duty';

/** Health data: prescription links live 5 minutes and every open is logged. */
const RX_URL_TTL = 300;
/** Indian prescriptions are generally honoured for up to 6 months for Schedule H medicines. */
const RX_MAX_AGE_DAYS = 180;

export interface PharmacyActor extends OrderActor {
  ip?: string;
}

export const RX_REJECT_REASONS = ['UNREADABLE', 'INCOMPLETE', 'TOO_OLD', 'NOT_PRESCRIBED', 'PATIENT_MISMATCH', 'OTHER'] as const;
export type RxRejectReason = (typeof RX_REJECT_REASONS)[number];
// The customer sees this text.
const REJECT_TEXT: Record<RxRejectReason, string> = {
  UNREADABLE: 'The prescription could not be read clearly',
  INCOMPLETE: 'The doctor’s name, registration number or signature is missing',
  TOO_OLD: 'The prescription is too old',
  NOT_PRESCRIBED: 'A medicine in the order is not on the prescription',
  PATIENT_MISMATCH: 'The patient details do not match',
  OTHER: 'The prescription could not be accepted',
};

export interface ApproveInput {
  pharmacistId?: string;
  doctorName: string;
  doctorRegNo: string;
  issuedOn: string; // YYYY-MM-DD
  patientName?: string;
  notes?: string;
}

const PHARMACIST_INCLUDE = { shifts: true, user: { select: { id: true, fullName: true, phone: true } } } satisfies Prisma.PharmacistInclude;
type PharmacistRow = Prisma.PharmacistGetPayload<{ include: typeof PHARMACIST_INCLUDE }>;

/**
 * Pharmacy prescription work (plan P17): who the store's registered pharmacists are, when they are on duty,
 * and the pharmacist's review of each prescription order before the store sees it as a new order.
 */
@Injectable()
export class PharmacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly orders: OrdersService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  // ------------------------------------------------------------------
  // Pharmacists & duty
  // ------------------------------------------------------------------

  async pharmacists(storeId: string, viewer: { userId: string; role: PartnerRole }) {
    const store = await this.pharmacy(storeId);
    const rows = await this.prisma.pharmacist.findMany({ where: { storeId, isActive: true }, include: PHARMACIST_INCLUDE, orderBy: { createdAt: 'asc' } });
    const now = new Date();
    const list = rows.map((p) => this.view(p, viewer.userId, now));
    const lead = viewer.role === 'OWNER' || viewer.role === 'MANAGER';
    // People who can be linked to a pharmacist registration (for "who approved this" and the duty switch).
    const members = lead
      ? await this.prisma.partnerMember.findMany({
          where: { partnerAccountId: store.partnerAccountId, isActive: true, role: { in: ['OWNER', 'MANAGER', 'PHARMACIST'] }, OR: [{ storeIds: { isEmpty: true } }, { storeIds: { has: storeId } }] },
          select: { role: true, user: { select: { id: true, fullName: true, phone: true } } },
        })
      : [];
    return {
      rxOpen: list.some((p) => p.duty.onDuty),
      canManage: lead,
      pharmacists: list,
      members: members.map((m) => ({ userId: m.user.id, name: m.user.fullName ?? maskPhone(m.user.phone), role: m.role })),
    };
  }

  private view(p: PharmacistRow, viewerId: string, now: Date) {
    const override = p.dutyOverride != null && p.dutyOverrideUntil && p.dutyOverrideUntil > now ? { on: p.dutyOverride, until: p.dutyOverrideUntil } : null;
    return {
      id: p.id,
      name: p.name,
      registrationNo: p.registrationNo,
      stateCouncil: p.stateCouncil,
      consented: !!p.consentAt,
      login: p.user ? { userId: p.user.id, name: p.user.fullName ?? maskPhone(p.user.phone) } : null,
      isMe: p.userId === viewerId,
      shifts: p.shifts.map((s) => ({ dayOfWeek: s.dayOfWeek, startsAt: s.startsAt, endsAt: s.endsAt })).sort((a, b) => a.dayOfWeek - b.dayOfWeek),
      duty: dutyState(p, now),
      override,
    };
  }

  async addPharmacist(storeId: string, input: { name: string; registrationNo: string; stateCouncil: string; shifts: Shift[] }, actor: PharmacyActor) {
    await this.pharmacy(storeId);
    const problem = shiftProblem(input.shifts);
    if (problem) throw new ApiError(HttpStatus.BAD_REQUEST, 'SHIFTS_INVALID', problem);
    const clash = await this.prisma.pharmacist.findFirst({ where: { registrationNo: input.registrationNo, stateCouncil: input.stateCouncil } });
    if (clash && clash.storeId !== storeId) throw new ApiError(HttpStatus.CONFLICT, 'PHARMACIST_ALREADY_REGISTERED', 'This pharmacist registration is already linked to another pharmacy');
    if (clash?.isActive) throw new ApiError(HttpStatus.CONFLICT, 'PHARMACIST_EXISTS', 'This pharmacist is already on your list');
    const data = { name: input.name, isActive: true, consentAt: new Date(), dutyOverride: null, dutyOverrideUntil: null };
    const p = clash
      ? await this.prisma.pharmacist.update({ where: { id: clash.id }, data })
      : await this.prisma.pharmacist.create({ data: { ...data, storeId, registrationNo: input.registrationNo, stateCouncil: input.stateCouncil } });
    await this.prisma.$transaction([this.prisma.pharmacistShift.deleteMany({ where: { pharmacistId: p.id } }), this.prisma.pharmacistShift.createMany({ data: input.shifts.map((s) => ({ ...s, pharmacistId: p.id })) })]);
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Pharmacist', entityId: p.id, action: 'CREATE', after: { name: input.name, registrationNo: input.registrationNo, stateCouncil: input.stateCouncil }, ip: actor.ip });
    await this.changed(storeId, actor);
    return this.pharmacists(storeId, { userId: actor.userId!, role: actor.role as PartnerRole });
  }

  async setShifts(storeId: string, pharmacistId: string, shifts: Shift[], actor: PharmacyActor) {
    const p = await this.mustOwn(storeId, pharmacistId);
    const problem = shiftProblem(shifts);
    if (problem) throw new ApiError(HttpStatus.BAD_REQUEST, 'SHIFTS_INVALID', problem);
    await this.prisma.$transaction([this.prisma.pharmacistShift.deleteMany({ where: { pharmacistId: p.id } }), this.prisma.pharmacistShift.createMany({ data: shifts.map((s) => ({ ...s, pharmacistId: p.id })) })]);
    await this.changed(storeId, actor);
    return this.pharmacists(storeId, { userId: actor.userId!, role: actor.role as PartnerRole });
  }

  /** "On duty now" / "Off duty now" for the rest of today, or back to the weekly shifts. */
  async setDuty(storeId: string, pharmacistId: string, mode: 'ON' | 'OFF' | 'SHIFTS', actor: PharmacyActor) {
    const p = await this.mustOwn(storeId, pharmacistId);
    // A pharmacist can switch only themselves; owners and managers can switch anyone.
    if (actor.role === 'PHARMACIST' && p.userId !== actor.userId) throw new ApiError(HttpStatus.FORBIDDEN, 'NOT_YOUR_DUTY', 'You can only change your own duty');
    if (mode === 'ON' && !p.consentAt) throw new ApiError(HttpStatus.CONFLICT, 'CONSENT_MISSING', 'This pharmacist has not confirmed they will check every prescription');
    const now = new Date();
    await this.prisma.pharmacist.update({ where: { id: p.id }, data: mode === 'SHIFTS' ? { dutyOverride: null, dutyOverrideUntil: null } : { dutyOverride: mode === 'ON', dutyOverrideUntil: endOfIstDay(now) } });
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Pharmacist', entityId: p.id, action: 'UPDATE', after: { duty: mode }, ip: actor.ip });
    await this.changed(storeId, actor);
    return this.pharmacists(storeId, { userId: actor.userId!, role: actor.role as PartnerRole });
  }

  /** Links the registration to a staff login, so their approvals and duty switch are their own. */
  async setLogin(storeId: string, pharmacistId: string, userId: string | null, actor: PharmacyActor) {
    const p = await this.mustOwn(storeId, pharmacistId);
    if (userId) {
      const store = await this.pharmacy(storeId);
      const member = await this.prisma.partnerMember.findFirst({ where: { partnerAccountId: store.partnerAccountId, userId, isActive: true, role: { in: ['OWNER', 'MANAGER', 'PHARMACIST'] } } });
      if (!member) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'MEMBER_NOT_FOUND', 'Add them as staff with the Pharmacist role first');
      const taken = await this.prisma.pharmacist.findFirst({ where: { storeId, userId, isActive: true, id: { not: p.id } } });
      if (taken) throw new ApiError(HttpStatus.CONFLICT, 'LOGIN_TAKEN', `This login is already linked to ${taken.name}`);
    }
    await this.prisma.pharmacist.update({ where: { id: p.id }, data: { userId } });
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Pharmacist', entityId: p.id, action: 'UPDATE', before: { userId: p.userId }, after: { userId }, ip: actor.ip });
    await this.changed(storeId, actor);
    return this.pharmacists(storeId, { userId: actor.userId!, role: actor.role as PartnerRole });
  }

  async remove(storeId: string, pharmacistId: string, actor: PharmacyActor) {
    const p = await this.mustOwn(storeId, pharmacistId);
    const others = await this.prisma.pharmacist.count({ where: { storeId, isActive: true, id: { not: p.id } } });
    if (!others) throw new ApiError(HttpStatus.CONFLICT, 'LAST_PHARMACIST', 'A pharmacy needs at least one registered pharmacist — add the new one first');
    await this.prisma.pharmacist.update({ where: { id: p.id }, data: { isActive: false, userId: null, dutyOverride: null, dutyOverrideUntil: null } });
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Pharmacist', entityId: p.id, action: 'STATUS_CHANGE', after: { isActive: false }, ip: actor.ip });
    await this.changed(storeId, actor);
    return this.pharmacists(storeId, { userId: actor.userId!, role: actor.role as PartnerRole });
  }

  // ------------------------------------------------------------------
  // Prescription review
  // ------------------------------------------------------------------

  /** The customer's prescription, as 5-minute links. Every open is in the audit trail. */
  async prescriptionFiles(storeId: string, orderId: string, actor: PharmacyActor) {
    const o = await this.prisma.order.findUnique({ where: { id: orderId }, include: { prescription: true } });
    if (!o || o.storeId !== storeId) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    if (!o.prescription) throw new ApiError(HttpStatus.NOT_FOUND, 'NO_PRESCRIPTION', 'No prescription was uploaded for this order');
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Prescription', entityId: o.prescription.id, action: 'UPDATE', after: { viewed: true, orderId, purpose: 'Prescription review' }, ip: actor.ip });
    return { files: o.prescription.fileUrls.map((k) => ({ url: this.storage.signedReadUrl(k, RX_URL_TTL), contentType: k.endsWith('.pdf') ? 'application/pdf' : 'image' })), expiresIn: RX_URL_TTL };
  }

  async approve(storeId: string, orderId: string, input: ApproveInput, actor: PharmacyActor) {
    await this.pharmacy(storeId);
    const o = await this.orders.mustOwn(storeId, orderId);
    if (!o.prescriptionId) throw new ApiError(HttpStatus.CONFLICT, 'NO_PRESCRIPTION', 'This order has no prescription to review');
    const reviewer = await this.reviewer(storeId, input.pharmacistId, actor, true);
    const issued = new Date(`${input.issuedOn}T00:00:00+05:30`);
    const now = new Date();
    if (Number.isNaN(issued.getTime()) || issued.getTime() > now.getTime()) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'RX_DATE_INVALID', 'The prescription date cannot be in the future');
    if (now.getTime() - issued.getTime() > RX_MAX_AGE_DAYS * 86_400_000) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'RX_TOO_OLD', `This prescription is more than ${RX_MAX_AGE_DAYS / 30} months old — reject it as too old`);
    await this.state.transition(orderId, 'RX_APPROVE', actor, {
      meta: { pharmacist: { id: reviewer.id, name: reviewer.name, registrationNo: reviewer.registrationNo } },
      inTx: async (tx, order) => {
        await tx.prescription.update({
          where: { id: order.prescriptionId! },
          data: { status: 'APPROVED', reviewedById: reviewer.id, reviewedAt: now, doctorName: input.doctorName, doctorRegNo: input.doctorRegNo, issuedOn: issued, patientName: input.patientName || null, reviewNotes: input.notes || null, rejectionReason: null },
        });
        await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Prescription', entityId: order.prescriptionId!, action: 'STATUS_CHANGE', after: { status: 'APPROVED', orderId, pharmacistId: reviewer.id }, ip: actor.ip }, tx);
      },
    });
    return this.orders.detailById(orderId);
  }

  async reject(storeId: string, orderId: string, input: { reason: RxRejectReason; note?: string; pharmacistId?: string }, actor: PharmacyActor) {
    await this.pharmacy(storeId);
    const o = await this.orders.mustOwn(storeId, orderId);
    if (!o.prescriptionId) throw new ApiError(HttpStatus.CONFLICT, 'NO_PRESCRIPTION', 'This order has no prescription to review');
    // Saying no is always safe, so it doesn't need a pharmacist on duty — but it records one when known.
    const reviewer = await this.reviewer(storeId, input.pharmacistId, actor, false).catch(() => null);
    const reason = input.note ? `${REJECT_TEXT[input.reason]}: ${input.note}` : REJECT_TEXT[input.reason];
    await this.state.transition(orderId, 'RX_REJECT', actor, {
      reason,
      meta: { code: input.reason, ...(reviewer ? { pharmacist: { id: reviewer.id, name: reviewer.name, registrationNo: reviewer.registrationNo } } : {}) },
      inTx: async (tx, order) => {
        await tx.prescription.update({ where: { id: order.prescriptionId! }, data: { status: 'REJECTED', rejectionReason: reason, reviewedAt: new Date(), reviewedById: reviewer?.id ?? null } });
        await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Prescription', entityId: order.prescriptionId!, action: 'STATUS_CHANGE', after: { status: 'REJECTED', orderId, reason: input.reason }, ip: actor.ip }, tx);
      },
    });
    return this.orders.detailById(orderId);
  }

  /**
   * Who is reviewing: a login linked to a pharmacist registration reviews as that pharmacist.
   * Owners/managers without a linked registration name the on-duty pharmacist who checked it.
   */
  private async reviewer(storeId: string, pharmacistId: string | undefined, actor: PharmacyActor, mustBeOnDuty: boolean) {
    const rows = await this.prisma.pharmacist.findMany({ where: { storeId, isActive: true }, include: PHARMACIST_INCLUDE });
    const mine = rows.find((p) => p.userId && p.userId === actor.userId);
    let p: PharmacistRow | undefined;
    if (mine) {
      if (pharmacistId && pharmacistId !== mine.id) throw new ApiError(HttpStatus.FORBIDDEN, 'REVIEW_AS_YOURSELF', 'Your login is linked to your own registration — you can only review as yourself');
      p = mine;
    } else if (actor.role === 'PHARMACIST') {
      throw new ApiError(HttpStatus.FORBIDDEN, 'LOGIN_NOT_LINKED', 'Ask the owner to link your login to your pharmacist registration (Prescriptions → Pharmacists)');
    } else {
      if (!pharmacistId) throw new ApiError(HttpStatus.BAD_REQUEST, 'PHARMACIST_REQUIRED', 'Choose the pharmacist who checked this prescription');
      p = rows.find((x) => x.id === pharmacistId);
      if (!p) throw new ApiError(HttpStatus.NOT_FOUND, 'PHARMACIST_NOT_FOUND', 'Pharmacist not found');
    }
    if (mustBeOnDuty && !dutyState(p).onDuty) throw new ApiError(HttpStatus.CONFLICT, 'PHARMACIST_OFF_DUTY', `${p.name} is not on duty — start their duty first`);
    return p;
  }

  // ------------------------------------------------------------------

  private async pharmacy(storeId: string) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true, vertical: true, partnerAccountId: true } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    if (store.vertical !== 'PHARMACY') throw new ApiError(HttpStatus.CONFLICT, 'NOT_A_PHARMACY', 'Prescriptions are for pharmacies only');
    return store;
  }

  private async mustOwn(storeId: string, pharmacistId: string) {
    await this.pharmacy(storeId);
    const p = await this.prisma.pharmacist.findUnique({ where: { id: pharmacistId } });
    if (!p || p.storeId !== storeId || !p.isActive) throw new ApiError(HttpStatus.NOT_FOUND, 'PHARMACIST_NOT_FOUND', 'Pharmacist not found');
    return p;
  }

  /** Other screens (and other staff) refresh who is on duty. */
  private async changed(storeId: string, actor: PharmacyActor) {
    await this.prisma.$transaction((tx) => this.events.publish(tx, { type: 'pharmacy.duty_changed', data: { storeId }, actor: { type: actor.kind, userId: actor.userId, role: actor.role } }));
  }
}
