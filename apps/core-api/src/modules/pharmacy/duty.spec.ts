import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dutyState, endOfIstDay, shiftProblem, shiftSlots, type DutyInput } from './duty';

// 2026-10-21 is a Wednesday (dayOfWeek 3). IST = UTC+5:30.
const ist = (date: string, time: string) => new Date(`${date}T${time}:00+05:30`);
const base: DutyInput = { isActive: true, consentAt: new Date('2026-01-01'), dutyOverride: null, dutyOverrideUntil: null, shifts: [{ dayOfWeek: 3, startsAt: '09:00', endsAt: '21:00' }] };

describe('pharmacist duty', () => {
  it('follows the weekly shift', () => {
    assert.deepEqual(dutyState(base, ist('2026-10-21', '10:00')), { onDuty: true, source: 'SHIFT', nextShift: null });
    assert.equal(dutyState(base, ist('2026-10-21', '08:59')).onDuty, false);
    assert.equal(dutyState(base, ist('2026-10-21', '08:59')).nextShift, 'today 09:00');
    assert.equal(dutyState(base, ist('2026-10-21', '21:00')).onDuty, false);
    assert.equal(dutyState(base, ist('2026-10-22', '10:00')).onDuty, false, 'Thursday has no shift');
  });

  it('handles a night shift that runs past midnight', () => {
    const night = { ...base, shifts: [{ dayOfWeek: 3, startsAt: '22:00', endsAt: '06:00' }] };
    assert.equal(dutyState(night, ist('2026-10-21', '23:30')).onDuty, true);
    assert.equal(dutyState(night, ist('2026-10-22', '05:59')).onDuty, true, 'Thursday early morning is still Wednesday’s shift');
    assert.equal(dutyState(night, ist('2026-10-22', '06:00')).onDuty, false);
    assert.equal(shiftSlots([{ dayOfWeek: 6, startsAt: '20:00', endsAt: '02:00' }])[1].dayOfWeek, 0, 'Saturday night spills into Sunday');
  });

  it('a manual switch beats the shift until it expires', () => {
    const until = endOfIstDay(ist('2026-10-21', '10:00'));
    const off = { ...base, dutyOverride: false, dutyOverrideUntil: until };
    assert.equal(dutyState(off, ist('2026-10-21', '10:00')).onDuty, false);
    assert.equal(dutyState(off, ist('2026-10-21', '10:00')).source, 'OFF');
    const on = { ...base, shifts: [], dutyOverride: true, dutyOverrideUntil: until };
    assert.deepEqual(dutyState(on, ist('2026-10-21', '23:00')), { onDuty: true, source: 'MANUAL', nextShift: null });
    assert.equal(dutyState(on, ist('2026-10-22', '00:01')).onDuty, false, 'expires at IST midnight');
  });

  it('never on duty when inactive or without consent', () => {
    assert.equal(dutyState({ ...base, isActive: false }, ist('2026-10-21', '10:00')).onDuty, false);
    assert.equal(dutyState({ ...base, consentAt: null, dutyOverride: true, dutyOverrideUntil: ist('2026-10-22', '00:00') }, ist('2026-10-21', '10:00')).onDuty, false);
  });

  it('manual switch ends at the next IST midnight', () => {
    assert.equal(endOfIstDay(ist('2026-10-21', '23:59')).toISOString(), ist('2026-10-22', '00:00').toISOString());
    assert.equal(endOfIstDay(ist('2026-10-21', '00:00')).toISOString(), ist('2026-10-22', '00:00').toISOString());
  });

  it('checks a week of shifts', () => {
    assert.equal(shiftProblem([]), 'Add at least one shift');
    assert.equal(shiftProblem([{ dayOfWeek: 1, startsAt: '9:00', endsAt: '18:00' }]), 'Use 24-hour times like 09:00');
    assert.equal(shiftProblem([{ dayOfWeek: 1, startsAt: '09:00', endsAt: '09:00' }]), 'A shift must end at a different time than it starts');
    assert.equal(shiftProblem([{ dayOfWeek: 1, startsAt: '09:00', endsAt: '13:00' }, { dayOfWeek: 1, startsAt: '14:00', endsAt: '18:00' }]), 'One shift per day');
    assert.equal(shiftProblem([{ dayOfWeek: 1, startsAt: '22:00', endsAt: '06:00' }]), null);
  });
});
