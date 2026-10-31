import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { closingNow, localParts, type Slot } from './hours';

// 15:00 in Kolkata; the slots below use whatever weekday that is.
const now = new Date('2026-10-30T15:00:00+05:30');
const day = localParts(now, 'Asia/Kolkata').dayOfWeek;
const slot = (opensAt: string, closesAt: string, extra: Partial<Slot> = {}): Slot => ({ dayOfWeek: day, opensAt, closesAt, ...extra });

describe('closingNow', () => {
  it('is the end of the slot the store is in', () => {
    assert.equal(closingNow([slot('09:00', '21:00')], now), '21:00');
  });

  it('follows back-to-back slots', () => {
    assert.equal(closingNow([slot('09:00', '16:00'), slot('16:00', '23:59')], now), '23:59');
  });

  it('ignores a later slot after a break', () => {
    assert.equal(closingNow([slot('09:00', '16:00'), slot('18:00', '23:00')], now), '16:00');
  });

  it('is null outside the hours, on a closed day, or with no hours', () => {
    assert.equal(closingNow([slot('06:00', '11:00')], now), null);
    assert.equal(closingNow([slot('09:00', '21:00', { isClosed: true })], now), null);
    assert.equal(closingNow([slot('09:00', '21:00', { dayOfWeek: (day + 1) % 7 })], now), null);
    assert.equal(closingNow([], now), null);
  });
});
