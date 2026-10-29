import type { Vertical } from '@delivez/db';

export const COUPON_KINDS = ['FLAT', 'PERCENT', 'FREE_DELIVERY'] as const;
export type CouponKind = (typeof COUPON_KINDS)[number];

/** Orders in these states don't use up a coupon (an unpaid draft that was dropped, a cancelled order…). */
export const NOT_COUNTED = ['CANCELLED', 'REJECTED', 'DELIVERY_FAILED', 'REFUNDED'] as const;

export interface CouponRule {
  discountType: string;
  discountValue: number;
  maxDiscount: number | null;
  minOrder: number;
  vertical: Vertical | null;
  storeId: string | null;
  cityId: string | null;
  usageLimit: number | null;
  perUserLimit: number;
  firstOrderOnly: boolean;
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
}

export interface Basket {
  /** Items total, paise. */
  items: number;
  /** Delivery fee before the coupon, paise. */
  delivery: number;
  storeId: string;
  vertical: Vertical;
  cityId: string | null;
  now: Date;
  /** Times the coupon was used by everyone / by this customer (orders that went ahead). */
  usedByAll: number;
  usedByMe: number;
  /** This customer's earlier orders that went ahead. */
  myOrders: number;
}

export type CouponProblem =
  | 'PAUSED'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'USED_UP'
  | 'ALREADY_USED'
  | 'FIRST_ORDER_ONLY'
  | 'OTHER_SHOP'
  | 'OTHER_CITY'
  | 'OTHER_KIND'
  | 'BELOW_MINIMUM'
  | 'NOTHING_OFF';

export type CouponCheck =
  | { ok: true; itemsOff: number; deliveryOff: number; saved: number }
  | { ok: false; problem: CouponProblem; /** BELOW_MINIMUM: paise still to add. */ short?: number };

/** Does this coupon apply to this basket, and how much does it take off? Order of checks = what the customer is told first. */
export function checkCoupon(c: CouponRule, b: Basket): CouponCheck {
  if (!c.isActive) return { ok: false, problem: 'PAUSED' };
  if (b.now < c.startsAt) return { ok: false, problem: 'NOT_STARTED' };
  if (b.now >= c.endsAt) return { ok: false, problem: 'EXPIRED' };
  if (c.storeId && c.storeId !== b.storeId) return { ok: false, problem: 'OTHER_SHOP' };
  if (c.vertical && c.vertical !== b.vertical) return { ok: false, problem: 'OTHER_KIND' };
  if (c.cityId && c.cityId !== b.cityId) return { ok: false, problem: 'OTHER_CITY' };
  // "You've already used it" first: when this customer holds the last use, that is the truer answer.
  if (b.usedByMe >= c.perUserLimit) return { ok: false, problem: 'ALREADY_USED' };
  if (c.usageLimit != null && b.usedByAll >= c.usageLimit) return { ok: false, problem: 'USED_UP' };
  if (c.firstOrderOnly && b.myOrders > 0) return { ok: false, problem: 'FIRST_ORDER_ONLY' };
  if (b.items < c.minOrder) return { ok: false, problem: 'BELOW_MINIMUM', short: c.minOrder - b.items };
  const off = discountOf(c, b);
  if (off.itemsOff + off.deliveryOff <= 0) return { ok: false, problem: 'NOTHING_OFF' };
  return { ok: true, ...off, saved: off.itemsOff + off.deliveryOff };
}

/** Never more than the items (or the delivery fee) themselves. */
export function discountOf(c: Pick<CouponRule, 'discountType' | 'discountValue' | 'maxDiscount'>, b: Pick<Basket, 'items' | 'delivery'>) {
  if (c.discountType === 'FREE_DELIVERY') return { itemsOff: 0, deliveryOff: b.delivery };
  let off = c.discountType === 'PERCENT' ? Math.round((b.items * c.discountValue) / 100) : c.discountValue;
  if (c.discountType === 'PERCENT' && c.maxDiscount != null) off = Math.min(off, c.maxDiscount);
  return { itemsOff: Math.max(0, Math.min(off, b.items)), deliveryOff: 0 };
}

/** What the coupon is, in a few words (admin list, offers strip). Amounts in paise. */
export function couponHeadline(c: Pick<CouponRule, 'discountType' | 'discountValue' | 'maxDiscount'>) {
  const rs = (p: number) => `₹${Math.round(p / 100)}`;
  if (c.discountType === 'FREE_DELIVERY') return 'Free delivery';
  if (c.discountType === 'PERCENT') return `${c.discountValue}% off${c.maxDiscount != null ? ` up to ${rs(c.maxDiscount)}` : ''}`;
  return `${rs(c.discountValue)} off`;
}

/** Customer-facing reason a code doesn't apply (the app has its own translated copy; this is the API message). */
export const PROBLEM_TEXT: Record<CouponProblem, string> = {
  PAUSED: 'This code isn’t available right now',
  NOT_STARTED: 'This offer hasn’t started yet',
  EXPIRED: 'This offer has ended',
  USED_UP: 'This offer has been fully used',
  ALREADY_USED: 'You’ve already used this code',
  FIRST_ORDER_ONLY: 'This code is for your first order',
  OTHER_SHOP: 'This code works at a different shop',
  OTHER_CITY: 'This code isn’t valid in your city',
  OTHER_KIND: 'This code works on a different kind of shop',
  BELOW_MINIMUM: 'Add a little more to use this code',
  NOTHING_OFF: 'This code takes nothing off this order',
};
