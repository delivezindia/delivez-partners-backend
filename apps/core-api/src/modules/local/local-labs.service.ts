import { HttpStatus, Injectable } from '@nestjs/common';
import type { LabCollectionType, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { LabBookingsService } from '../lab-bookings/lab-bookings.service';
import { PRE_COLLECTION } from '../lab-bookings/lab-booking-state';
import { LocalAccountService } from './local-account.service';

export interface LabBookInput {
  storeId: string;
  collectionType: LabCollectionType;
  slotStart: Date;
  testIds: string[];
  patient: { name: string; age?: number; gender?: 'F' | 'M' | 'O' };
  addressId?: string;
  note?: string;
  prescriptionFileKeys?: string[];
}

const INCLUDE = {
  items: true,
  store: { select: { id: true, name: true, slug: true, phone: true, addressLine1: true, lat: true, lng: true } },
  prescription: { select: { status: true, rejectionReason: true } },
  reports: { where: { supersededAt: null }, orderBy: { version: 'desc' }, select: { id: true, version: true, summary: true, createdAt: true } },
} satisfies Prisma.LabBookingInclude;
type Row = Prisma.LabBookingGetPayload<{ include: typeof INCLUDE }>;

/**
 * Lab tests in the customer app: pick tests → home collection or walk-in → an hourly slot → book.
 * Paid at collection (cash / UPI to the collector or the desk) — the lab confirms, collects with the booking code,
 * and releases the pathologist-signed report here.
 */
@Injectable()
export class LocalLabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly labs: LabBookingsService,
    private readonly account: LocalAccountService,
  ) {}

  async slots(storeId: string, date: string, type: LabCollectionType) {
    const lab = await this.lab(storeId);
    return this.labs.slots(lab.id, date, type);
  }

  async rxUpload(userId: string, storeId: string, contentType: string, size: number) {
    await this.account.customer(userId);
    const lab = await this.lab(storeId);
    return this.labs.rxUpload(lab.id, contentType, size);
  }

  async book(userId: string, input: LabBookInput) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.account.customer(userId);
    let address: { line1: string; landmark?: string; pincode: string; lat: number; lng: number } | undefined;
    if (input.collectionType === 'HOME') {
      if (!input.addressId) throw new ApiError(HttpStatus.BAD_REQUEST, 'ADDRESS_REQUIRED', 'Choose the address for sample collection');
      const a = await this.prisma.address.findFirst({ where: { id: input.addressId, userId, deletedAt: null } });
      if (!a) throw new ApiError(HttpStatus.NOT_FOUND, 'ADDRESS_NOT_FOUND', 'Choose the address for sample collection');
      address = { line1: [a.line1, a.line2].filter(Boolean).join(', '), landmark: a.landmark ?? undefined, pincode: a.pincode, lat: a.lat, lng: a.lng };
    }
    const b = await this.labs.create(
      {
        storeId: input.storeId,
        channel: 'LOCAL_WEB',
        collectionType: input.collectionType,
        slotStart: input.slotStart,
        customer: { phone: user.phone, name: user.fullName ?? undefined },
        patient: input.patient,
        testIds: [...new Set(input.testIds)],
        paymentMode: 'COD',
        address,
        note: input.note,
        prescriptionFileKeys: input.prescriptionFileKeys,
      },
      { kind: 'CUSTOMER', userId },
    );
    return this.detail(userId, b.id);
  }

  async list(userId: string) {
    const customer = await this.account.customer(userId);
    const rows = await this.prisma.labBooking.findMany({ where: { customerId: customer.id }, include: INCLUDE, orderBy: { slotStart: 'desc' }, take: 50 });
    return { bookings: rows.map((b) => this.view(b)) };
  }

  async detail(userId: string, idOrNumber: string) {
    const customer = await this.account.customer(userId);
    const where = /^LAB-\d+$/i.test(idOrNumber) ? { bookingNumber: idOrNumber.toUpperCase() } : { id: idOrNumber };
    const b = await this.prisma.labBooking.findFirst({ where: { ...where, customerId: customer.id }, include: INCLUDE });
    if (!b) throw new ApiError(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Booking not found');
    const events = await this.prisma.labBookingEvent.findMany({ where: { bookingId: b.id }, orderBy: { createdAt: 'asc' }, select: { toState: true, createdAt: true } });
    return { ...this.view(b), timeline: events.map((e) => ({ status: e.toState, at: e.createdAt })) };
  }

  async cancel(userId: string, id: string, reason?: string) {
    const b = await this.detail(userId, id);
    await this.labs.transition(null, b.id, 'CANCEL', { kind: 'CUSTOMER', userId }, { reason: reason || 'Cancelled by customer' });
    return this.detail(userId, b.id);
  }

  async reschedule(userId: string, id: string, slotStart: Date) {
    const b = await this.detail(userId, id);
    await this.labs.reschedule(null, b.id, slotStart, { kind: 'CUSTOMER', userId });
    return this.detail(userId, b.id);
  }

  /** A 5-minute link to the signed report; every open is logged. */
  async report(userId: string, id: string, reportId: string) {
    const b = await this.detail(userId, id);
    return this.labs.reportFile(b.id, reportId, { kind: 'CUSTOMER', userId }, 'Patient viewed own report', null);
  }

  private async lab(idOrSlug: string) {
    const lab = await this.prisma.store.findFirst({
      where: { ...(/^[0-9a-f-]{36}$/i.test(idOrSlug) ? { id: idOrSlug } : { slug: idOrSlug }), vertical: 'DIAGNOSTICS', status: { in: ['LIVE', 'LIMITED'] } },
      select: { id: true },
    });
    if (!lab) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'This lab isn’t taking bookings on Delivez');
    return lab;
  }

  /** The patient's view: includes their booking code (read out to the collector), never other patients' data. */
  private view(b: Row) {
    const open = PRE_COLLECTION.includes(b.status);
    return {
      id: b.id,
      bookingNumber: b.bookingNumber,
      status: b.status,
      active: !['REPORT_READY', 'CANCELLED', 'REJECTED'].includes(b.status),
      collectionType: b.collectionType,
      slotStart: b.slotStart,
      slotMinutes: b.slotMinutes,
      lab: { id: b.store.id, name: b.store.name, slug: b.store.slug, phone: b.store.phone, address: b.store.addressLine1 },
      patient: { name: b.patientName, age: b.patientAge, gender: b.patientGender },
      address: b.address ? [(b.address as { line1?: string }).line1, (b.address as { pincode?: string }).pincode].filter(Boolean).join(', ') : null,
      tests: b.items.map((i) => ({ id: i.id, name: i.testName, price: i.unitPrice, sampleType: i.sampleType, fastingHours: i.fastingHours, reportHours: i.reportHours })),
      fastingHours: Math.max(0, ...b.items.map((i) => i.fastingHours ?? 0)),
      totals: { tests: b.itemsSubtotal, collectionFee: b.collectionFee, grandTotal: b.grandTotal },
      payment: { mode: b.paymentMode, status: b.paymentStatus },
      code: open || b.status === 'SAMPLE_COLLECTED' ? b.collectionOtp : null,
      collector: b.collectorName ? { name: b.collectorName.split(/\s+/)[0], phone: b.collectorPhone } : null,
      rx: b.rxRequired ? { status: b.prescription?.status ?? null, rejectionReason: b.prescription?.rejectionReason ?? null } : null,
      reports: b.reports.map((r) => ({ id: r.id, version: r.version, summary: r.summary, releasedAt: r.createdAt })),
      canCancel: open,
      cancelReason: b.cancelReason,
      createdAt: b.createdAt,
    };
  }
}
