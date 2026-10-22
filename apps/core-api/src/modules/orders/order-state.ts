import type { FulfilmentType, OrderStatus } from '@delivez/db';

// Order state machine (plan §10.1). Pure: no I/O, so every allowed/disallowed move is unit-tested.
// Only OrderStateService applies these transitions to orders.status.

export type ActorKind = 'PARTNER' | 'SYSTEM' | 'ADMIN' | 'RIDER' | 'CUSTOMER';

export type OrderAction =
  | 'ACCEPT'
  | 'REJECT'
  | 'START_PREPARING'
  | 'READY_SOON'
  | 'MARK_READY'
  | 'HANDOVER'
  | 'PICKUP_COMPLETE'
  | 'OUT_FOR_DELIVERY'
  | 'ARRIVE'
  | 'DELIVER'
  | 'FAIL_DELIVERY'
  | 'CANCEL';

interface Rule {
  from: OrderStatus[];
  to: OrderStatus;
  actors: ActorKind[];
  /** Only for this fulfilment type. */
  fulfilment?: FulfilmentType;
  /** Narrower `from` for specific actors (customers may only cancel before the store accepts). */
  fromFor?: Partial<Record<ActorKind, OrderStatus[]>>;
  needsReason?: boolean;
}

const KITCHEN: OrderStatus[] = ['ACCEPTED', 'PREPARING', 'READY_SOON'];

export const RULES: Record<OrderAction, Rule> = {
  ACCEPT: { from: ['PLACED'], to: 'ACCEPTED', actors: ['PARTNER', 'SYSTEM'] },
  REJECT: { from: ['PLACED'], to: 'REJECTED', actors: ['PARTNER', 'SYSTEM'], needsReason: true },
  START_PREPARING: { from: ['ACCEPTED'], to: 'PREPARING', actors: ['PARTNER', 'SYSTEM'] },
  READY_SOON: { from: ['ACCEPTED', 'PREPARING'], to: 'READY_SOON', actors: ['PARTNER'] },
  MARK_READY: { from: KITCHEN, to: 'READY', actors: ['PARTNER'] },
  // Delivery: the store hands the sealed order to the rider (OTP / QR).
  HANDOVER: { from: ['READY'], to: 'PICKED_UP', actors: ['PARTNER', 'RIDER', 'ADMIN'], fulfilment: 'DELIVERY' },
  // Self-pickup: the customer collects with their pickup OTP; the order is complete.
  PICKUP_COMPLETE: { from: ['READY'], to: 'COMPLETED', actors: ['PARTNER'], fulfilment: 'PICKUP' },
  OUT_FOR_DELIVERY: { from: ['PICKED_UP'], to: 'OUT_FOR_DELIVERY', actors: ['RIDER', 'ADMIN'], fulfilment: 'DELIVERY' },
  ARRIVE: { from: ['OUT_FOR_DELIVERY'], to: 'ARRIVED', actors: ['RIDER', 'ADMIN'], fulfilment: 'DELIVERY' },
  DELIVER: { from: ['OUT_FOR_DELIVERY', 'ARRIVED'], to: 'DELIVERED', actors: ['RIDER', 'ADMIN'], fulfilment: 'DELIVERY' },
  FAIL_DELIVERY: { from: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED'], to: 'DELIVERY_FAILED', actors: ['RIDER', 'ADMIN'], fulfilment: 'DELIVERY', needsReason: true },
  CANCEL: {
    from: ['PLACED', ...KITCHEN, 'READY'],
    to: 'CANCELLED',
    actors: ['CUSTOMER', 'ADMIN', 'SYSTEM'],
    fromFor: { CUSTOMER: ['PLACED'] },
    needsReason: true,
  },
};

/** States the store still has to act on (kitchen/counter screens). */
export const ACTIVE_STATES: OrderStatus[] = ['PLACED', ...KITCHEN, 'READY'];
export const TERMINAL_STATES: OrderStatus[] = ['DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DELIVERY_FAILED', 'REFUNDED'];

export type TransitionCheck = { ok: true; to: OrderStatus } | { ok: false; code: 'ACTOR_NOT_ALLOWED' | 'WRONG_FULFILMENT' | 'ORDER_INVALID_TRANSITION' | 'REASON_REQUIRED'; message: string };

/** Decides whether `actor` may apply `action` to an order in `status`. */
export function checkTransition(action: OrderAction, order: { status: OrderStatus; fulfilmentType: FulfilmentType }, actor: ActorKind, reason?: string | null): TransitionCheck {
  const rule = RULES[action];
  if (!rule.actors.includes(actor)) {
    return { ok: false, code: 'ACTOR_NOT_ALLOWED', message: `${actor.toLowerCase()} cannot ${humanAction(action)}` };
  }
  if (rule.fulfilment && rule.fulfilment !== order.fulfilmentType) {
    return { ok: false, code: 'WRONG_FULFILMENT', message: `Only ${rule.fulfilment.toLowerCase()} orders can ${humanAction(action)}` };
  }
  const from = rule.fromFor?.[actor] ?? rule.from;
  if (!from.includes(order.status)) {
    return { ok: false, code: 'ORDER_INVALID_TRANSITION', message: `A ${order.status.toLowerCase().replace(/_/g, ' ')} order cannot ${humanAction(action)}` };
  }
  if (rule.needsReason && !reason?.trim()) {
    return { ok: false, code: 'REASON_REQUIRED', message: 'A reason is required' };
  }
  return { ok: true, to: rule.to };
}

export function humanAction(action: OrderAction) {
  const words: Record<OrderAction, string> = {
    ACCEPT: 'be accepted',
    REJECT: 'be rejected',
    START_PREPARING: 'start preparing',
    READY_SOON: 'be marked ready soon',
    MARK_READY: 'be marked ready',
    HANDOVER: 'be handed over',
    PICKUP_COMPLETE: 'be collected',
    OUT_FOR_DELIVERY: 'go out for delivery',
    ARRIVE: 'arrive',
    DELIVER: 'be delivered',
    FAIL_DELIVERY: 'fail delivery',
    CANCEL: 'be cancelled',
  };
  return words[action];
}
