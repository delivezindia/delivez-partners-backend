import { isWithinHours, localParts, nextOpening, type Slot } from '../../common/hours';
import type { PrismaService } from '../../prisma/prisma.service';

// Pharmacist duty (plan §5.5 / P17): prescription orders only reach a pharmacy while a registered
// pharmacist is on duty. Duty = the weekly shifts, unless someone switched it on/off by hand for today.
// Pure apart from pharmacistsOnDuty(), so the rules are unit-tested.

export interface Shift {
  dayOfWeek: number; // 0 = Sun (IST)
  startsAt: string; // "HH:MM"
  endsAt: string; // "HH:MM"; earlier than startsAt = runs past midnight
}

export interface DutyInput {
  isActive: boolean;
  consentAt: Date | null;
  dutyOverride: boolean | null;
  dutyOverrideUntil: Date | null;
  shifts: Shift[];
}

export interface DutyState {
  onDuty: boolean;
  source: 'MANUAL' | 'SHIFT' | 'OFF';
  /** "today 09:00" when off duty and a shift is coming up. */
  nextShift: string | null;
}

/** Shifts as opening-hours slots; a shift past midnight becomes two slots. */
export function shiftSlots(shifts: Shift[]): Slot[] {
  return shifts.flatMap((s) =>
    s.endsAt > s.startsAt
      ? [{ dayOfWeek: s.dayOfWeek, opensAt: s.startsAt, closesAt: s.endsAt }]
      : [
          { dayOfWeek: s.dayOfWeek, opensAt: s.startsAt, closesAt: '24:00' },
          ...(s.endsAt > '00:00' ? [{ dayOfWeek: (s.dayOfWeek + 1) % 7, opensAt: '00:00', closesAt: s.endsAt }] : []),
        ],
  );
}

export function dutyState(p: DutyInput, now = new Date()): DutyState {
  if (!p.isActive || !p.consentAt) return { onDuty: false, source: 'OFF', nextShift: null };
  const slots = shiftSlots(p.shifts);
  if (p.dutyOverride != null && p.dutyOverrideUntil && p.dutyOverrideUntil > now) {
    return { onDuty: p.dutyOverride, source: p.dutyOverride ? 'MANUAL' : 'OFF', nextShift: null };
  }
  // isWithinHours treats "no hours" as always open; no shifts means never on duty here.
  const inShift = slots.length > 0 && isWithinHours(slots, [], now);
  return { onDuty: inShift, source: inShift ? 'SHIFT' : 'OFF', nextShift: inShift ? null : nextOpening(slots, now) };
}

/** A manual switch lasts until the end of the IST day it was made on. */
export function endOfIstDay(now = new Date()) {
  const { date } = localParts(now, 'Asia/Kolkata');
  return new Date(new Date(`${date}T00:00:00+05:30`).getTime() + 86_400_000);
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Problems with a week of shifts, or null when it is fine. */
export function shiftProblem(shifts: Shift[]): string | null {
  if (!shifts.length) return 'Add at least one shift';
  for (const s of shifts) {
    if (!HHMM.test(s.startsAt) || !HHMM.test(s.endsAt)) return 'Use 24-hour times like 09:00';
    if (s.startsAt === s.endsAt) return 'A shift must end at a different time than it starts';
  }
  const days = shifts.map((s) => s.dayOfWeek);
  if (new Set(days).size !== days.length) return 'One shift per day';
  return null;
}

/** Active, consented pharmacists of a store who are on duty right now. */
export async function pharmacistsOnDuty(prisma: PrismaService, storeId: string, now = new Date()) {
  const rows = await prisma.pharmacist.findMany({ where: { storeId, isActive: true }, include: { shifts: true } });
  return rows.filter((p) => dutyState(p, now).onDuty);
}
