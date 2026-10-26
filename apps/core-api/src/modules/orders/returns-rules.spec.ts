import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkReturn, returnsAllowed, windowState } from './returns-rules';

const items = [
  { id: 'a', qty: 2, returnedQty: 0, unitPrice: 5000, isOutOfStock: false },
  { id: 'b', qty: 1, returnedQty: 1, unitPrice: 9000, isOutOfStock: false },
  { id: 'c', qty: 1, returnedQty: 0, unitPrice: 3000, isOutOfStock: true },
];

describe('doorstep returns', () => {
  it('only grocery / local store deliveries', () => {
    assert.equal(returnsAllowed('GROCERY', 'DELIVERY'), true);
    assert.equal(returnsAllowed('LOCAL_STORES', 'DELIVERY'), true);
    assert.equal(returnsAllowed('GROCERY', 'PICKUP'), false, 'pickup: the customer checks at the counter');
    assert.equal(returnsAllowed('EAT', 'DELIVERY'), false);
    assert.equal(returnsAllowed('PHARMACY', 'DELIVERY'), false);
  });

  it('window open for 5 minutes, closed early or after', () => {
    const now = new Date('2026-10-26T10:00:00Z');
    assert.equal(windowState({ returnWindowEndsAt: null, returnWindowClosedAt: null }, now), 'NONE');
    assert.equal(windowState({ returnWindowEndsAt: new Date('2026-10-26T10:03:00Z'), returnWindowClosedAt: null }, now), 'OPEN');
    assert.equal(windowState({ returnWindowEndsAt: new Date('2026-10-26T10:03:00Z'), returnWindowClosedAt: now }, now), 'CLOSED');
    assert.equal(windowState({ returnWindowEndsAt: new Date('2026-10-26T09:59:59Z'), returnWindowClosedAt: null }, now), 'CLOSED');
  });

  it('refund = price × quantity', () => {
    const r = checkReturn(items, [{ itemId: 'a', qty: 2, reason: 'DAMAGED' }]);
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.total, 10000);
  });

  it('refuses what can’t come back', () => {
    const code = (req: Parameters<typeof checkReturn>[1]) => { const r = checkReturn(items, req); return r.ok ? 'OK' : r.code; };
    assert.equal(code([]), 'NOTHING_TO_RETURN');
    assert.equal(code([{ itemId: 'a', qty: 3, reason: 'DAMAGED' }]), 'TOO_MANY');
    assert.equal(code([{ itemId: 'b', qty: 1, reason: 'DAMAGED' }]), 'TOO_MANY', 'already returned');
    assert.equal(code([{ itemId: 'c', qty: 1, reason: 'MISSING' }]), 'ITEM_NOT_ON_ORDER', 'removed before delivery');
    assert.equal(code([{ itemId: 'zz', qty: 1, reason: 'MISSING' }]), 'ITEM_NOT_ON_ORDER');
    assert.equal(code([{ itemId: 'a', qty: 1, reason: 'DAMAGED' }, { itemId: 'a', qty: 1, reason: 'EXPIRED' }]), 'DUPLICATE_ITEM');
  });
});
