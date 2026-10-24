import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { summaryDueAt } from './digests.service';

describe('end-of-day summary time', () => {
  const t = (dayOfWeek: number, closesAt: string, isClosed = false) => ({ dayOfWeek, closesAt, isClosed });
  it('15 minutes after the last closing time today', () => {
    assert.equal(summaryDueAt([t(3, '15:00'), t(3, '22:00'), t(4, '23:00')], 3), 22 * 60 + 15);
  });
  it('22:30 when the store has no hours set', () => {
    assert.equal(summaryDueAt([], 3), 22 * 60 + 30);
  });
  it('never later than 23:45', () => {
    assert.equal(summaryDueAt([t(3, '24:00')], 3), 23 * 60 + 45);
  });
  it('nothing on a day the store is closed', () => {
    assert.equal(summaryDueAt([t(3, '22:00', true), t(4, '22:00')], 3), null);
  });
});
