import type { OrderStatus, PaymentMode, Vertical } from '@delivez/db';

/*
 * Order SLA (docs/order-sla.html). Pure: no I/O, so every rule is unit-tested in sla.spec.ts.
 *  1. Time limits for each stage and what happens when one is missed.
 *  2. What a cancellation / failed delivery means for the customer, the shop and the goods —
 *     decided by WHY (the code → whose fault) and WHEN (the stage).
 */

// ---------------------------------------------------------------------------
// 1. Time limits
// ---------------------------------------------------------------------------

export const SLA = {
  /** Shop must accept a new order (existing timer). Missed → auto-rejected, shop's fault. */
  ACCEPT_SECONDS: 180,
  /** Pharmacist must review a prescription (existing timer). Missed → auto-cancelled, shop's fault. */
  RX_REVIEW_MINUTES: 15,
  /** Past the promised ready time by this much → the shop is told it is running late. */
  PREP_LATE_MINUTES: 10,
  /** Past the promised ready time by this much → ops are alerted to step in (call the shop / cancel). */
  PREP_STUCK_MINUTES: 30,
  /** Ready (or accepted and due) with no rider assigned for this long → ops are alerted. */
  NO_RIDER_MINUTES: 10,
  /** Rider at the customer's door with no handover for this long → ops decide: deliver or fail. */
  DOOR_WAIT_MINUTES: 10,
} as const;

export type SlaBreach = 'PREP_LATE' | 'PREP_STUCK' | 'NO_RIDER' | 'DOOR_WAIT';

// ---------------------------------------------------------------------------
// 2. Cancellation codes — every cancel / reject / failed delivery carries one
// ---------------------------------------------------------------------------

export type Fault = 'CUSTOMER' | 'STORE' | 'PLATFORM' | 'RIDER' | 'NO_FAULT';

export const CANCEL_CODES = {
  // Customer, in the app (only before the shop accepts)
  CUSTOMER_CANCELLED: 'CUSTOMER',
  // Shop rejects (Partners app reasons)
  STORE_ITEMS_UNAVAILABLE: 'STORE',
  STORE_TOO_BUSY: 'STORE',
  STORE_CLOSING: 'STORE',
  STORE_KITCHEN_ISSUE: 'STORE',
  STORE_OTHER: 'STORE',
  // Timers
  ACCEPT_TIMEOUT: 'STORE',
  RX_TIMEOUT: 'STORE',
  // Pharmacist rejects the prescription (invalid / unclear) — nobody is charged
  RX_REJECTED: 'NO_FAULT',
  // Ops (Admin → Orders → Cancel)
  OPS_STORE_CANNOT_FULFIL: 'STORE',
  OPS_NO_RIDER: 'PLATFORM',
  OPS_PLATFORM_ISSUE: 'PLATFORM',
  OPS_CUSTOMER_REQUEST: 'CUSTOMER',
  OPS_DUPLICATE_ORDER: 'NO_FAULT',
  OPS_FORCE_MAJEURE: 'NO_FAULT',
  // Delivery failed after pickup (rider / ops)
  FAIL_CUSTOMER_UNAVAILABLE: 'CUSTOMER',
  FAIL_CUSTOMER_REFUSED: 'CUSTOMER',
  FAIL_WRONG_ADDRESS: 'CUSTOMER',
  FAIL_RIDER_ISSUE: 'RIDER',
  FAIL_DAMAGED_IN_TRANSIT: 'RIDER',
  FAIL_FORCE_MAJEURE: 'NO_FAULT',
} as const satisfies Record<string, Fault>;

export type CancelCode = keyof typeof CANCEL_CODES;

export const OPS_CANCEL_CODES = [
  'OPS_STORE_CANNOT_FULFIL',
  'OPS_NO_RIDER',
  'OPS_PLATFORM_ISSUE',
  'OPS_CUSTOMER_REQUEST',
  'OPS_DUPLICATE_ORDER',
  'OPS_FORCE_MAJEURE',
] as const satisfies readonly CancelCode[];
export const FAIL_CODES = [
  'FAIL_CUSTOMER_UNAVAILABLE',
  'FAIL_CUSTOMER_REFUSED',
  'FAIL_WRONG_ADDRESS',
  'FAIL_RIDER_ISSUE',
  'FAIL_DAMAGED_IN_TRANSIT',
  'FAIL_FORCE_MAJEURE',
] as const satisfies readonly CancelCode[];

/** Plain-English label (store screens, admin, event payloads). The customer app has its own translated text per code. */
export const CANCEL_TEXT: Record<CancelCode, string> = {
  CUSTOMER_CANCELLED: 'Cancelled by the customer',
  STORE_ITEMS_UNAVAILABLE: 'Items unavailable',
  STORE_TOO_BUSY: 'Store too busy',
  STORE_CLOSING: 'Store closing',
  STORE_KITCHEN_ISSUE: 'Kitchen / equipment issue',
  STORE_OTHER: 'Rejected by the store',
  ACCEPT_TIMEOUT: 'Not accepted within 3 minutes',
  RX_TIMEOUT: `Prescription not reviewed within ${SLA.RX_REVIEW_MINUTES} minutes`,
  RX_REJECTED: 'Prescription not accepted by the pharmacist',
  OPS_STORE_CANNOT_FULFIL: 'Store could not complete the order',
  OPS_NO_RIDER: 'No rider available',
  OPS_PLATFORM_ISSUE: 'Delivez technical / operations issue',
  OPS_CUSTOMER_REQUEST: 'Customer asked support to cancel',
  OPS_DUPLICATE_ORDER: 'Duplicate order',
  OPS_FORCE_MAJEURE: 'Weather, strike or emergency',
  FAIL_CUSTOMER_UNAVAILABLE: 'Customer not reachable at the address',
  FAIL_CUSTOMER_REFUSED: 'Customer refused the order',
  FAIL_WRONG_ADDRESS: 'Wrong or incomplete address',
  FAIL_RIDER_ISSUE: 'Rider could not complete the trip',
  FAIL_DAMAGED_IN_TRANSIT: 'Order damaged on the way',
  FAIL_FORCE_MAJEURE: 'Weather, strike or emergency',
};

export const isCancelCode = (s: unknown): s is CancelCode => typeof s === 'string' && s in CANCEL_CODES;

// ---------------------------------------------------------------------------
// 3. Outcome: who gets what
// ---------------------------------------------------------------------------

/** How far the order had got when it ended. */
export type Stage = 'BEFORE_ACCEPT' | 'PREPARING' | 'READY' | 'PICKED_UP';

export function stageOf(status: OrderStatus): Stage {
  if (status === 'AWAITING_RX_REVIEW' || status === 'PLACED') return 'BEFORE_ACCEPT';
  if (status === 'ACCEPTED' || status === 'PREPARING' || status === 'READY_SOON') return 'PREPARING';
  if (status === 'READY') return 'READY';
  return 'PICKED_UP';
}

export interface OutcomeInput {
  code: CancelCode;
  stage: Stage;
  vertical: Vertical;
  paymentMode: PaymentMode;
  totals: {
    items: number;
    delivery: number;
    packaging: number;
    grandTotal: number;
  };
}

export interface Outcome {
  fault: Fault;
  /** Prepaid: paise back to the customer's payment. COD: always 0 (nothing was taken). */
  refund: number;
  /** COD only: what the customer should have paid but didn't (customer's fault after the shop started). Recorded, not charged. */
  customerDue: number;
  /** What Delivez owes the shop for goods it cannot sell again (cooked food), when the shop is not at fault. */
  storeCompensation: number;
  /** RELEASE: still at the shop, reserved stock freed · RETURN_TO_STORE: rider brings it back · WRITE_OFF: cooked food, thrown away. */
  goods: 'RELEASE' | 'RETURN_TO_STORE' | 'WRITE_OFF';
  /** Whose record it goes on: store health (STORE), COD strikes (CUSTOMER), rider quality (RIDER). */
  countsAgainst: 'STORE' | 'CUSTOMER' | 'RIDER' | null;
}

/**
 * The cancellation matrix.
 *  - Shop / platform / rider / no-fault: the customer gets everything back.
 *  - Customer before the shop accepts: free.
 *  - Customer after the shop started: cooked food is not refunded; goods that go back on the shelf are refunded
 *    except the delivery fee (the trip happened).
 *  - The shop is paid for cooked food whenever the cancel was not its fault.
 */
export function cancellationOutcome(i: OutcomeInput): Outcome {
  const fault = CANCEL_CODES[i.code];
  const food = i.vertical === 'EAT';
  const started = i.stage !== 'BEFORE_ACCEPT';
  const goods: Outcome['goods'] = i.stage !== 'PICKED_UP' ? 'RELEASE' : food ? 'WRITE_OFF' : 'RETURN_TO_STORE';
  const prepaid = i.paymentMode !== 'COD';
  const foodValue = i.totals.items + i.totals.packaging;

  // What the customer is charged for (kept from a prepaid payment, or owed on COD).
  let charge = 0;
  if (fault === 'CUSTOMER' && started) {
    if (food)
      charge = i.totals.grandTotal; // the food was made for them
    else if (i.stage === 'PICKED_UP') charge = i.totals.delivery; // goods come back, the trip was made
  }

  const storeCompensation = fault !== 'STORE' && food && started ? foodValue : 0;
  const countsAgainst = fault === 'STORE' ? 'STORE' : fault === 'RIDER' ? 'RIDER' : fault === 'CUSTOMER' && started ? 'CUSTOMER' : null;

  return {
    fault,
    refund: prepaid ? i.totals.grandTotal - charge : 0,
    customerDue: prepaid ? 0 : charge,
    storeCompensation,
    goods,
    countsAgainst,
  };
}
