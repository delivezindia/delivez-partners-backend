import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkCoupon, couponHeadline, discountOf, type Basket, type CouponRule } from './coupon-rules';
import { itemsLeave } from '../orders/discount';

const now = new Date('2026-11-01T10:00:00Z');
const rule = (r: Partial<CouponRule> = {}): CouponRule => ({
  discountType: 'FLAT',
  discountValue: 5000,
  maxDiscount: null,
  minOrder: 0,
  vertical: null,
  storeId: null,
  cityId: null,
  usageLimit: null,
  perUserLimit: 1,
  firstOrderOnly: false,
  startsAt: new Date('2026-10-01T00:00:00Z'),
  endsAt: new Date('2026-12-01T00:00:00Z'),
  isActive: true,
  ...r,
});
const basket = (b: Partial<Basket> = {}): Basket => ({ items: 40000, delivery: 3000, storeId: 's1', vertical: 'EAT', cityId: 'c1', now, usedByAll: 0, usedByMe: 0, myOrders: 3, ...b });

describe('discountOf', () => {
  it('flat takes its value, never more than the items', () => {
    assert.deepEqual(discountOf(rule(), basket()), { itemsOff: 5000, deliveryOff: 0 });
    assert.deepEqual(discountOf(rule(), basket({ items: 3000 })), { itemsOff: 3000, deliveryOff: 0 });
  });
  it('percent rounds to the paisa and respects the cap', () => {
    assert.equal(discountOf(rule({ discountType: 'PERCENT', discountValue: 20 }), basket({ items: 33333 })).itemsOff, 6667);
    assert.equal(discountOf(rule({ discountType: 'PERCENT', discountValue: 50, maxDiscount: 10000 }), basket()).itemsOff, 10000);
  });
  it('free delivery takes the delivery fee only', () => {
    assert.deepEqual(discountOf(rule({ discountType: 'FREE_DELIVERY', discountValue: 0 }), basket()), { itemsOff: 0, deliveryOff: 3000 });
  });
});

describe('checkCoupon', () => {
  it('a fitting basket gets the discount', () => {
    assert.deepEqual(checkCoupon(rule(), basket()), { ok: true, itemsOff: 5000, deliveryOff: 0, saved: 5000 });
  });
  it('paused, not started and ended coupons are refused', () => {
    assert.equal(fail(rule({ isActive: false }), basket()), 'PAUSED');
    assert.equal(fail(rule({ startsAt: new Date('2026-11-02T00:00:00Z') }), basket()), 'NOT_STARTED');
    assert.equal(fail(rule({ endsAt: now }), basket()), 'EXPIRED');
  });
  it('shop, kind of shop and city must match when set', () => {
    assert.equal(fail(rule({ storeId: 's2' }), basket()), 'OTHER_SHOP');
    assert.equal(fail(rule({ vertical: 'GROCERY' }), basket()), 'OTHER_KIND');
    assert.equal(fail(rule({ cityId: 'c2' }), basket()), 'OTHER_CITY');
    assert.equal(checkCoupon(rule({ storeId: 's1', vertical: 'EAT', cityId: 'c1' }), basket()).ok, true);
  });
  it('total and per-customer limits', () => {
    assert.equal(fail(rule({ usageLimit: 100 }), basket({ usedByAll: 100 })), 'USED_UP');
    assert.equal(fail(rule(), basket({ usedByMe: 1 })), 'ALREADY_USED');
    assert.equal(checkCoupon(rule({ perUserLimit: 3 }), basket({ usedByMe: 2 })).ok, true);
  });
  it('first-order coupons only before the first order', () => {
    assert.equal(fail(rule({ firstOrderOnly: true }), basket()), 'FIRST_ORDER_ONLY');
    assert.equal(checkCoupon(rule({ firstOrderOnly: true }), basket({ myOrders: 0 })).ok, true);
  });
  it('below the minimum says how much to add', () => {
    assert.deepEqual(checkCoupon(rule({ minOrder: 49900 }), basket()), { ok: false, problem: 'BELOW_MINIMUM', short: 9900 });
  });
  it('free delivery with no delivery fee takes nothing off', () => {
    assert.equal(fail(rule({ discountType: 'FREE_DELIVERY', discountValue: 0 }), basket({ delivery: 0 })), 'NOTHING_OFF');
  });
});

describe('couponHeadline', () => {
  it('reads like the offer', () => {
    assert.equal(couponHeadline(rule()), '₹50 off');
    assert.equal(couponHeadline(rule({ discountType: 'PERCENT', discountValue: 20, maxDiscount: 10000 })), '20% off up to ₹100');
    assert.equal(couponHeadline(rule({ discountType: 'FREE_DELIVERY', discountValue: 0 })), 'Free delivery');
  });
});

describe('itemsLeave (refund with a coupon)', () => {
  it('without a coupon the refund is the full line', () => {
    assert.equal(itemsLeave({ itemsSubtotal: 40000, discountAmount: 0 }, 10000).refund, 10000);
  });
  it('the coupon’s share of the removed items is kept back', () => {
    const r = itemsLeave({ itemsSubtotal: 40000, discountAmount: 8000 }, 10000);
    assert.equal(r.share, 2000);
    assert.equal(r.refund, 8000);
  });
  it('removing everything hands back exactly what was paid for the items', () => {
    const r = itemsLeave({ itemsSubtotal: 40000, discountAmount: 8000 }, 40000);
    assert.equal(r.refund, 32000);
  });
});

function fail(c: CouponRule, b: Basket) {
  const r = checkCoupon(c, b);
  return r.ok ? 'OK' : r.problem;
}
