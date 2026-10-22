import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { LabBookingStatus, LabCollectionType } from '@delivez/db';
import { checkLabTransition, LAB_RULES, type LabAction, type LabActor } from './lab-booking-state';

const STATES: LabBookingStatus[] = ['BOOKED', 'RX_REVIEW', 'CONFIRMED', 'COLLECTOR_ASSIGNED', 'SAMPLE_COLLECTED', 'PROCESSING', 'REPORT_READY', 'CANCELLED', 'REJECTED'];
const ACTORS: LabActor[] = ['PARTNER', 'SYSTEM', 'ADMIN', 'CUSTOMER'];
const TYPES: LabCollectionType[] = ['HOME', 'WALK_IN'];
const PRE: LabBookingStatus[] = ['BOOKED', 'RX_REVIEW', 'CONFIRMED', 'COLLECTOR_ASSIGNED'];

// Independent statement of what should be allowed: (actor, type) → from-states, and the resulting state.
type Allow = (actor: LabActor, type: LabCollectionType) => LabBookingStatus[];
const P = (states: LabBookingStatus[], type?: LabCollectionType): Allow => (a, t) => (a === 'PARTNER' && (!type || type === t) ? states : []);
const EXPECTED: Record<LabAction, { to: LabBookingStatus; allow: Allow }> = {
  APPROVE_RX: { to: 'CONFIRMED', allow: P(['RX_REVIEW']) },
  REJECT_RX: { to: 'REJECTED', allow: P(['RX_REVIEW']) },
  CONFIRM: { to: 'CONFIRMED', allow: P(['BOOKED']) },
  REJECT: { to: 'REJECTED', allow: P(['BOOKED', 'CONFIRMED', 'COLLECTOR_ASSIGNED']) },
  ASSIGN_COLLECTOR: { to: 'COLLECTOR_ASSIGNED', allow: P(['CONFIRMED', 'COLLECTOR_ASSIGNED'], 'HOME') },
  COLLECT: { to: 'SAMPLE_COLLECTED', allow: (a, t) => (a !== 'PARTNER' ? [] : t === 'HOME' ? ['COLLECTOR_ASSIGNED'] : ['CONFIRMED']) },
  START_PROCESSING: { to: 'PROCESSING', allow: P(['SAMPLE_COLLECTED']) },
  RELEASE_REPORT: { to: 'REPORT_READY', allow: P(['SAMPLE_COLLECTED', 'PROCESSING']) },
  AMEND_REPORT: { to: 'REPORT_READY', allow: P(['REPORT_READY']) },
  CANCEL: { to: 'CANCELLED', allow: (a) => (a === 'PARTNER' ? [] : PRE) },
};

describe('lab booking state machine', () => {
  it('covers every action', () => assert.deepEqual(Object.keys(LAB_RULES).sort(), Object.keys(EXPECTED).sort()));

  for (const action of Object.keys(EXPECTED) as LabAction[]) {
    it(`${action}: allowed and disallowed moves`, () => {
      const exp = EXPECTED[action];
      for (const status of STATES)
        for (const actor of ACTORS)
          for (const collectionType of TYPES) {
            const res = checkLabTransition(action, { status, collectionType }, actor, 'reason');
            const should = exp.allow(actor, collectionType).includes(status);
            assert.equal(res.ok, should, `${action} ${status} by ${actor} (${collectionType})`);
            if (res.ok) assert.equal(res.to, exp.to);
          }
    });
  }

  it('a home sample needs an assigned collector; walk-ins are collected at the desk', () => {
    assert.equal(checkLabTransition('COLLECT', { status: 'CONFIRMED', collectionType: 'HOME' }, 'PARTNER').ok, false);
    assert.equal(checkLabTransition('COLLECT', { status: 'CONFIRMED', collectionType: 'WALK_IN' }, 'PARTNER').ok, true);
  });

  it('no cancelling once the sample is taken; reports can be amended only with a reason', () => {
    for (const s of ['SAMPLE_COLLECTED', 'PROCESSING', 'REPORT_READY'] as LabBookingStatus[]) assert.equal(checkLabTransition('CANCEL', { status: s, collectionType: 'HOME' }, 'ADMIN', 'x').ok, false);
    assert.equal((checkLabTransition('AMEND_REPORT', { status: 'REPORT_READY', collectionType: 'HOME' }, 'PARTNER') as { code: string }).code, 'REASON_REQUIRED');
  });

  it('closed bookings stay closed', () => {
    for (const s of ['CANCELLED', 'REJECTED'] as LabBookingStatus[])
      for (const a of Object.keys(LAB_RULES) as LabAction[]) for (const actor of ACTORS) assert.equal(checkLabTransition(a, { status: s, collectionType: 'WALK_IN' }, actor, 'x').ok, false);
  });
});
