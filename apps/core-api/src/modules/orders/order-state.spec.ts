import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FulfilmentType, OrderStatus } from '@delivez/db';
import { checkTransition, RULES, type ActorKind, type OrderAction } from './order-state';

const STATES: OrderStatus[] = [
  'DRAFT', 'AWAITING_RX_REVIEW', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_SOON', 'READY', 'PICKED_UP',
  'OUT_FOR_DELIVERY', 'ARRIVED', 'DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DELIVERY_FAILED', 'REFUNDED',
];
const ACTORS: ActorKind[] = ['PARTNER', 'SYSTEM', 'ADMIN', 'RIDER', 'CUSTOMER'];
const FULFILMENT: FulfilmentType[] = ['DELIVERY', 'PICKUP'];

// The expected matrix, written out independently of RULES: action → allowed (actor, from) → to.
const EXPECTED: Record<OrderAction, { to: OrderStatus; allow: Partial<Record<ActorKind, OrderStatus[]>>; only?: FulfilmentType }> = {
  RX_APPROVE: { to: 'PLACED', allow: { PARTNER: ['AWAITING_RX_REVIEW'] } },
  RX_REJECT: { to: 'REJECTED', allow: { PARTNER: ['AWAITING_RX_REVIEW'] } },
  ACCEPT: { to: 'ACCEPTED', allow: { PARTNER: ['PLACED'], SYSTEM: ['PLACED'] } },
  REJECT: { to: 'REJECTED', allow: { PARTNER: ['PLACED'], SYSTEM: ['PLACED'] } },
  START_PREPARING: { to: 'PREPARING', allow: { PARTNER: ['ACCEPTED'], SYSTEM: ['ACCEPTED'] } },
  READY_SOON: { to: 'READY_SOON', allow: { PARTNER: ['ACCEPTED', 'PREPARING'] } },
  MARK_READY: { to: 'READY', allow: { PARTNER: ['ACCEPTED', 'PREPARING', 'READY_SOON'] } },
  HANDOVER: { to: 'PICKED_UP', allow: { PARTNER: ['READY'], RIDER: ['READY'], ADMIN: ['READY'] }, only: 'DELIVERY' },
  PICKUP_COMPLETE: { to: 'COMPLETED', allow: { PARTNER: ['READY'] }, only: 'PICKUP' },
  OUT_FOR_DELIVERY: { to: 'OUT_FOR_DELIVERY', allow: { RIDER: ['PICKED_UP'], ADMIN: ['PICKED_UP'] }, only: 'DELIVERY' },
  ARRIVE: { to: 'ARRIVED', allow: { RIDER: ['OUT_FOR_DELIVERY'], ADMIN: ['OUT_FOR_DELIVERY'] }, only: 'DELIVERY' },
  DELIVER: { to: 'DELIVERED', allow: { RIDER: ['OUT_FOR_DELIVERY', 'ARRIVED'], ADMIN: ['OUT_FOR_DELIVERY', 'ARRIVED'] }, only: 'DELIVERY' },
  FAIL_DELIVERY: { to: 'DELIVERY_FAILED', allow: { RIDER: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED'], ADMIN: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED'] }, only: 'DELIVERY' },
  CANCEL: {
    to: 'CANCELLED',
    allow: {
      CUSTOMER: ['AWAITING_RX_REVIEW', 'PLACED'],
      ADMIN: ['AWAITING_RX_REVIEW', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_SOON', 'READY'],
      SYSTEM: ['AWAITING_RX_REVIEW', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_SOON', 'READY'],
    },
  },
};

describe('order state machine', () => {
  it('covers every action', () => {
    assert.deepEqual(Object.keys(RULES).sort(), Object.keys(EXPECTED).sort());
  });

  // Exhaustive: every action × state × actor × fulfilment (14 × 16 × 5 × 2 = 2,240 cases).
  for (const action of Object.keys(EXPECTED) as OrderAction[]) {
    it(`${action}: allowed and disallowed moves`, () => {
      const exp = EXPECTED[action];
      let allowed = 0;
      for (const status of STATES)
        for (const actor of ACTORS)
          for (const fulfilmentType of FULFILMENT) {
            const res = checkTransition(action, { status, fulfilmentType }, actor, 'because');
            const should = (exp.allow[actor] ?? []).includes(status) && (!exp.only || exp.only === fulfilmentType);
            assert.equal(res.ok, should, `${action} ${status} by ${actor} (${fulfilmentType}) → expected ${should ? 'allowed' : 'blocked'}`);
            if (res.ok) {
              allowed++;
              assert.equal(res.to, exp.to);
            }
          }
      assert.ok(allowed > 0, `${action} must be possible from somewhere`);
    });
  }

  it('explains why a move is blocked', () => {
    const order = { status: 'PREPARING' as OrderStatus, fulfilmentType: 'DELIVERY' as FulfilmentType };
    assert.equal((checkTransition('ACCEPT', order, 'PARTNER') as { code: string }).code, 'ORDER_INVALID_TRANSITION');
    assert.equal((checkTransition('DELIVER', order, 'PARTNER') as { code: string }).code, 'ACTOR_NOT_ALLOWED');
    assert.equal((checkTransition('PICKUP_COMPLETE', { ...order, status: 'READY' }, 'PARTNER') as { code: string }).code, 'WRONG_FULFILMENT');
  });

  it('requires reasons for reject, cancel and failed delivery', () => {
    const placed = { status: 'PLACED' as OrderStatus, fulfilmentType: 'DELIVERY' as FulfilmentType };
    assert.equal((checkTransition('REJECT', placed, 'PARTNER', '  ') as { code: string }).code, 'REASON_REQUIRED');
    assert.equal((checkTransition('CANCEL', placed, 'ADMIN') as { code: string }).code, 'REASON_REQUIRED');
    assert.equal(checkTransition('ACCEPT', placed, 'PARTNER').ok, true);
    const rx = { status: 'AWAITING_RX_REVIEW' as OrderStatus, fulfilmentType: 'DELIVERY' as FulfilmentType };
    assert.equal((checkTransition('RX_REJECT', rx, 'PARTNER') as { code: string }).code, 'REASON_REQUIRED');
    assert.equal(checkTransition('RX_APPROVE', rx, 'PARTNER').ok, true);
  });

  it('a prescription order reaches the store only after the pharmacist approves it', () => {
    const rx = { status: 'AWAITING_RX_REVIEW' as OrderStatus, fulfilmentType: 'PICKUP' as FulfilmentType };
    assert.equal(checkTransition('ACCEPT', rx, 'PARTNER').ok, false);
    assert.equal(checkTransition('ACCEPT', rx, 'SYSTEM').ok, false);
    assert.equal(checkTransition('RX_APPROVE', rx, 'SYSTEM').ok, false);
    assert.equal(checkTransition('CANCEL', rx, 'SYSTEM', 'not reviewed in time').ok, true);
  });

  it('customers can only cancel before the store accepts', () => {
    assert.equal(checkTransition('CANCEL', { status: 'PLACED', fulfilmentType: 'PICKUP' }, 'CUSTOMER', 'changed mind').ok, true);
    assert.equal(checkTransition('CANCEL', { status: 'ACCEPTED', fulfilmentType: 'PICKUP' }, 'CUSTOMER', 'changed mind').ok, false);
    assert.equal(checkTransition('CANCEL', { status: 'ACCEPTED', fulfilmentType: 'PICKUP' }, 'ADMIN', 'store issue').ok, true);
  });

  it('no action leaves a terminal state', () => {
    for (const status of ['DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DELIVERY_FAILED', 'REFUNDED'] as OrderStatus[])
      for (const action of Object.keys(RULES) as OrderAction[])
        for (const actor of ACTORS) for (const fulfilmentType of FULFILMENT) assert.equal(checkTransition(action, { status, fulfilmentType }, actor, 'x').ok, false, `${action} from ${status}`);
  });
});
