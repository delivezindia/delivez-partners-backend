import type { LabBookingStatus, LabCollectionType } from '@delivez/db';

// Lab booking state machine (Step 9b). Pure — unit tested like the order machine.

export type LabActor = 'PARTNER' | 'SYSTEM' | 'ADMIN' | 'CUSTOMER';
export type LabAction =
  | 'APPROVE_RX'
  | 'REJECT_RX'
  | 'CONFIRM'
  | 'REJECT'
  | 'ASSIGN_COLLECTOR'
  | 'COLLECT'
  | 'START_PROCESSING'
  | 'RELEASE_REPORT'
  | 'AMEND_REPORT'
  | 'CANCEL';

interface Rule {
  from: LabBookingStatus[];
  to: LabBookingStatus;
  actors: LabActor[];
  /** Different starting states per collection type (home needs a collector first). */
  fromByType?: Partial<Record<LabCollectionType, LabBookingStatus[]>>;
  only?: LabCollectionType;
  needsReason?: boolean;
}

/** Before the sample is taken — the booking can still be cancelled or rescheduled. */
export const PRE_COLLECTION: LabBookingStatus[] = ['BOOKED', 'RX_REVIEW', 'CONFIRMED', 'COLLECTOR_ASSIGNED'];

export const LAB_RULES: Record<LabAction, Rule> = {
  APPROVE_RX: { from: ['RX_REVIEW'], to: 'CONFIRMED', actors: ['PARTNER'] },
  REJECT_RX: { from: ['RX_REVIEW'], to: 'REJECTED', actors: ['PARTNER'], needsReason: true },
  CONFIRM: { from: ['BOOKED'], to: 'CONFIRMED', actors: ['PARTNER'] },
  REJECT: { from: ['BOOKED', 'CONFIRMED', 'COLLECTOR_ASSIGNED'], to: 'REJECTED', actors: ['PARTNER'], needsReason: true },
  ASSIGN_COLLECTOR: { from: ['CONFIRMED', 'COLLECTOR_ASSIGNED'], to: 'COLLECTOR_ASSIGNED', actors: ['PARTNER'], only: 'HOME' },
  COLLECT: { from: [], fromByType: { HOME: ['COLLECTOR_ASSIGNED'], WALK_IN: ['CONFIRMED'] }, to: 'SAMPLE_COLLECTED', actors: ['PARTNER'] },
  START_PROCESSING: { from: ['SAMPLE_COLLECTED'], to: 'PROCESSING', actors: ['PARTNER'] },
  RELEASE_REPORT: { from: ['SAMPLE_COLLECTED', 'PROCESSING'], to: 'REPORT_READY', actors: ['PARTNER'] },
  AMEND_REPORT: { from: ['REPORT_READY'], to: 'REPORT_READY', actors: ['PARTNER'], needsReason: true },
  CANCEL: { from: PRE_COLLECTION, to: 'CANCELLED', actors: ['CUSTOMER', 'ADMIN', 'SYSTEM'], needsReason: true },
};

export type LabCheck = { ok: true; to: LabBookingStatus } | { ok: false; code: 'ACTOR_NOT_ALLOWED' | 'WRONG_COLLECTION_TYPE' | 'BOOKING_INVALID_TRANSITION' | 'REASON_REQUIRED'; message: string };

export function checkLabTransition(action: LabAction, b: { status: LabBookingStatus; collectionType: LabCollectionType }, actor: LabActor, reason?: string | null): LabCheck {
  const rule = LAB_RULES[action];
  if (!rule.actors.includes(actor)) return { ok: false, code: 'ACTOR_NOT_ALLOWED', message: `${actor.toLowerCase()} cannot do this` };
  if (rule.only && rule.only !== b.collectionType) return { ok: false, code: 'WRONG_COLLECTION_TYPE', message: 'Only home-collection bookings have a collector' };
  const from = rule.fromByType?.[b.collectionType] ?? rule.from;
  if (!from.includes(b.status)) {
    return { ok: false, code: 'BOOKING_INVALID_TRANSITION', message: `Not possible while the booking is ${b.status.toLowerCase().replace(/_/g, ' ')}` };
  }
  if (rule.needsReason && !reason?.trim()) return { ok: false, code: 'REASON_REQUIRED', message: 'A reason is required' };
  return { ok: true, to: rule.to };
}
