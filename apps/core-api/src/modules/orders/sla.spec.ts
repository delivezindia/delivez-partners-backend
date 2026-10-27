import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CANCEL_CODES, CANCEL_TEXT, FAIL_CODES, OPS_CANCEL_CODES, cancellationOutcome, stageOf, type CancelCode, type Stage } from './sla';

// ₹400 items + ₹30 delivery + ₹20 packaging = ₹450
const totals = {
  items: 40000,
  delivery: 3000,
  packaging: 2000,
  grandTotal: 45000,
};
const run = (code: CancelCode, stage: Stage, vertical: 'EAT' | 'GROCERY' | 'PHARMACY' = 'EAT', paymentMode: 'UPI' | 'COD' = 'UPI') =>
  cancellationOutcome({
    code,
    stage,
    vertical,
    paymentMode,
    totals: vertical === 'EAT' ? totals : { ...totals, packaging: 0, grandTotal: 43000 },
  });

describe('order SLA: stages', () => {
  it('maps every status to a stage', () => {
    assert.equal(stageOf('PLACED'), 'BEFORE_ACCEPT');
    assert.equal(stageOf('AWAITING_RX_REVIEW'), 'BEFORE_ACCEPT');
    assert.equal(stageOf('ACCEPTED'), 'PREPARING');
    assert.equal(stageOf('READY_SOON'), 'PREPARING');
    assert.equal(stageOf('READY'), 'READY');
    assert.equal(stageOf('OUT_FOR_DELIVERY'), 'PICKED_UP');
    assert.equal(stageOf('ARRIVED'), 'PICKED_UP');
  });
  it('every code has a label', () => {
    for (const c of Object.keys(CANCEL_CODES)) assert.ok(CANCEL_TEXT[c as CancelCode], c);
    assert.ok([...OPS_CANCEL_CODES, ...FAIL_CODES].every((c) => c in CANCEL_CODES));
  });
});

describe('order SLA: who pays when an order ends early', () => {
  it('customer cancels before the shop accepts → free, nobody affected', () => {
    const o = run('CUSTOMER_CANCELLED', 'BEFORE_ACCEPT');
    assert.deepEqual(o, {
      fault: 'CUSTOMER',
      refund: 45000,
      customerDue: 0,
      storeCompensation: 0,
      goods: 'RELEASE',
      countsAgainst: null,
    });
  });

  it('shop rejects or misses the order → full refund, counts against the shop, no compensation', () => {
    for (const code of ['STORE_TOO_BUSY', 'ACCEPT_TIMEOUT', 'RX_TIMEOUT'] as const) {
      const o = run(code, 'BEFORE_ACCEPT');
      assert.equal(o.refund, 45000);
      assert.equal(o.countsAgainst, 'STORE');
      assert.equal(o.storeCompensation, 0);
    }
  });

  it('shop cannot finish after accepting → full refund, shop not paid for its own failure', () => {
    const o = run('OPS_STORE_CANNOT_FULFIL', 'PREPARING');
    assert.equal(o.refund, 45000);
    assert.equal(o.storeCompensation, 0);
    assert.equal(o.countsAgainst, 'STORE');
  });

  it('no rider (platform) while food is cooking → customer refunded in full, shop paid for the food', () => {
    const o = run('OPS_NO_RIDER', 'READY');
    assert.equal(o.refund, 45000);
    assert.equal(o.storeCompensation, 42000, 'items + packaging');
    assert.equal(o.goods, 'RELEASE');
    assert.equal(o.countsAgainst, null);
  });

  it('grocery cancelled by the platform before pickup → refund, goods stay on the shelf, no compensation needed', () => {
    const o = run('OPS_NO_RIDER', 'READY', 'GROCERY');
    assert.equal(o.refund, 43000);
    assert.equal(o.storeCompensation, 0);
    assert.equal(o.goods, 'RELEASE');
  });

  it('customer not at the door with cooked food → no refund, food written off, shop paid, customer strike', () => {
    const o = run('FAIL_CUSTOMER_UNAVAILABLE', 'PICKED_UP');
    assert.deepEqual(o, {
      fault: 'CUSTOMER',
      refund: 0,
      customerDue: 0,
      storeCompensation: 42000,
      goods: 'WRITE_OFF',
      countsAgainst: 'CUSTOMER',
    });
  });

  it('same on cash on delivery → nothing to refund, the unpaid amount is recorded', () => {
    const o = run('FAIL_CUSTOMER_REFUSED', 'PICKED_UP', 'EAT', 'COD');
    assert.equal(o.refund, 0);
    assert.equal(o.customerDue, 45000);
    assert.equal(o.storeCompensation, 42000);
  });

  it('customer refuses groceries → items come back to the shop, refund minus the delivery fee', () => {
    const o = run('FAIL_WRONG_ADDRESS', 'PICKED_UP', 'GROCERY');
    assert.equal(o.goods, 'RETURN_TO_STORE');
    assert.equal(o.refund, 40000, '₹430 paid − ₹30 delivery');
    assert.equal(o.storeCompensation, 0);
    const cod = run('FAIL_WRONG_ADDRESS', 'PICKED_UP', 'GROCERY', 'COD');
    assert.equal(cod.customerDue, 3000, 'only the trip');
  });

  it('rider issue after pickup → customer fully refunded, shop paid for food, counts against the rider', () => {
    const o = run('FAIL_RIDER_ISSUE', 'PICKED_UP');
    assert.equal(o.refund, 45000);
    assert.equal(o.storeCompensation, 42000);
    assert.equal(o.countsAgainst, 'RIDER');
    assert.equal(run('FAIL_DAMAGED_IN_TRANSIT', 'PICKED_UP', 'PHARMACY').goods, 'RETURN_TO_STORE');
  });

  it('force majeure → nobody blamed, customer refunded, shop paid for cooked food', () => {
    const o = run('FAIL_FORCE_MAJEURE', 'PICKED_UP');
    assert.equal(o.fault, 'NO_FAULT');
    assert.equal(o.refund, 45000);
    assert.equal(o.storeCompensation, 42000);
    assert.equal(o.countsAgainst, null);
  });

  it('customer asks support to cancel while cooking → food charged; a grocery order is free', () => {
    assert.equal(run('OPS_CUSTOMER_REQUEST', 'PREPARING').refund, 0);
    assert.equal(run('OPS_CUSTOMER_REQUEST', 'PREPARING', 'GROCERY').refund, 43000);
  });
});
