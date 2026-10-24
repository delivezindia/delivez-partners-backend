import { randomInt, randomUUID } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { LabCollectionType, PaymentMode } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { LabBookingsService, type LabActorCtx } from './lab-bookings.service';

const PATIENTS: [string, number, 'F' | 'M'][] = [
  ['Lakshmi Iyer', 54, 'F'],
  ['Rohan Mehta', 32, 'M'],
  ['Fatima Khan', 41, 'F'],
  ['Suresh Babu', 67, 'M'],
  ['Neha Joshi', 28, 'F'],
  ['Anil Kumar', 45, 'M'],
];
const DOCTORS = ['Dr. S. Prakash, MD (Gen Med) - KMC 45812', 'Dr. R. Nair, MD (Endocrinology) - KMC 39021', 'Dr. A. Gupta, MBBS - KMC 51207'];

/**
 * Dev-only booking generator: creates bookings in the next free slots with the lab's own tests,
 * flagged isTestBooking. For prescription tests it writes a small sample prescription PDF.
 */
@Injectable()
export class LabSimulatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly bookings: LabBookingsService,
  ) {}

  async simulate(storeId: string, opts: { count: number; collection: 'HOME' | 'WALK_IN' | 'ANY'; rx: 'YES' | 'NO' | 'ANY'; payment: 'COD' | 'UPI' | 'ANY' }, actor: LabActorCtx) {
    if (process.env.NODE_ENV === 'production') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    const store = await this.prisma.store.findUnique({ where: { id: storeId } });
    if (!store || store.vertical !== 'DIAGNOSTICS') throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'NOT_A_LAB', 'Test bookings are for diagnostics labs');
    const now = new Date();
    const tests = await this.prisma.product.findMany({ where: { storeId, deletedAt: null, isAvailable: true, OR: [{ pausedUntil: null }, { pausedUntil: { lt: now } }] } });
    if (!tests.length) throw new ApiError(HttpStatus.CONFLICT, 'NOTHING_TO_BOOK', 'Add some tests first');

    const created = [];
    for (let n = 0; n < opts.count; n++) {
      const type: LabCollectionType = opts.collection !== 'ANY' ? opts.collection : store.supportsDelivery && (!store.supportsPickup || Math.random() < 0.6) ? 'HOME' : 'WALK_IN';
      const fits = tests.filter((t) => (type === 'HOME' ? t.labHomeCollection !== false : t.labWalkIn !== false));
      const rxTests = fits.filter((t) => t.prescriptionRequired);
      const plain = fits.filter((t) => !t.prescriptionRequired);
      const wantRx = opts.rx === 'YES' || (opts.rx === 'ANY' && rxTests.length > 0 && Math.random() < 0.4);
      if (wantRx && !rxTests.length) throw new ApiError(HttpStatus.CONFLICT, 'NO_RX_TESTS', 'Mark a test as "prescription required" first');
      const pickPlain = shuffle(plain).slice(0, randomInt(1, Math.min(3, Math.max(1, plain.length)) + 1));
      const picks = wantRx ? [rxTests[randomInt(0, rxTests.length)], ...pickPlain.slice(0, 1)] : pickPlain;
      if (!picks.length) throw new ApiError(HttpStatus.CONFLICT, 'NOTHING_TO_BOOK', `No tests offered for ${type === 'HOME' ? 'home collection' : 'walk-in'}`);

      const slotStart = await this.nextSlot(storeId, type);
      const [name, age, gender] = PATIENTS[randomInt(0, PATIENTS.length)];
      let prescriptionFileKeys: string[] | undefined;
      if (picks.some((t) => t.prescriptionRequired)) {
        const key = `stores/${storeId}/lab-rx/${randomUUID()}.pdf`;
        this.storage.putFile(key, samplePrescriptionPdf(name, age, picks.filter((t) => t.prescriptionRequired).map((t) => t.name)));
        prescriptionFileKeys = [key];
      }
      const payment: PaymentMode = opts.payment === 'ANY' ? (Math.random() < 0.65 ? 'UPI' : 'COD') : opts.payment;
      created.push(
        await this.bookings.create(
          {
            storeId,
            channel: 'LOCAL_APP',
            collectionType: type,
            slotStart,
            customer: { phone: `+9170000001${String(randomInt(0, 100)).padStart(2, '0')}`, name },
            patient: { name, age, gender },
            testIds: [...new Set(picks.map((t) => t.id))],
            paymentMode: payment,
            address: type === 'HOME' ? nearby(store.lat!, store.lng!, Math.min(store.deliveryRadiusKm, 3) * 0.8, store.pincode ?? '560001') : undefined,
            prescriptionFileKeys,
            isTestBooking: true,
          },
          actor,
        ),
      );
    }
    return { bookings: created };
  }

  private async nextSlot(storeId: string, type: LabCollectionType) {
    for (let d = 0; d < 7; d++) {
      const date = new Date(Date.now() + 5.5 * 3600_000 + d * 86_400_000).toISOString().slice(0, 10);
      const day = await this.bookings.slots(storeId, date, type);
      const free = day.slots.find((s) => s.available);
      if (free) return free.start;
    }
    throw new ApiError(HttpStatus.CONFLICT, 'NO_SLOTS', 'No free slots in the next 7 days - check the lab hours');
  }
}

function shuffle<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

function nearby(lat: number, lng: number, km: number, pincode: string) {
  const r = (km * Math.sqrt(Math.random())) / 111;
  const t = Math.random() * 2 * Math.PI;
  return { line1: `${randomInt(1, 300)}, ${randomInt(1, 15)}th Main`, landmark: 'Near the park', pincode, lat: lat + r * Math.cos(t), lng: lng + (r * Math.sin(t)) / Math.cos((lat * Math.PI) / 180) };
}

/** A small, valid one-page PDF that looks like a prescription (dev fixture). */
export function samplePrescriptionPdf(patient: string, age: number, tests: string[], heading = 'Investigations advised:') {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7E]/g, '');
  const doctor = DOCTORS[randomInt(0, DOCTORS.length)];
  const lines = [
    ['F2', 16, 'SAMPLE PRESCRIPTION (TEST DATA)'],
    ['F1', 11, doctor],
    ['F1', 11, `Patient: ${patient}, ${age} y    Date: ${new Date().toISOString().slice(0, 10)}`],
    ['F2', 12, heading],
    ...tests.map((t) => ['F1', 12, `- ${t}`]),
    ['F1', 10, 'Generated by the Delivez dev simulator - not a real prescription.'],
  ] as [string, number, string][];
  let y = 790;
  const content = lines.map(([f, size, text]) => `BT /${f} ${size} Tf 50 ${(y -= size + 14)} Td (${esc(text)}) Tj ET`).join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}
