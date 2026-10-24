import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { healthFlags, istWeekStart } from './admin-reports.service';

describe('admin reports', () => {
  it('weeks start on Monday in India', () => {
    // Thu 2026-10-22 18:00 IST → Monday 2026-10-19 00:00 IST
    const thu = new Date('2026-10-22T18:00:00+05:30').getTime();
    assert.equal(istWeekStart(0, thu).toISOString(), new Date('2026-10-19T00:00:00+05:30').toISOString());
    assert.equal(istWeekStart(1, thu).toISOString(), new Date('2026-10-12T00:00:00+05:30').toISOString());
    // Monday 00:30 IST is still that Monday's week (Sunday evening UTC)
    const mon = new Date('2026-10-19T00:30:00+05:30').getTime();
    assert.equal(istWeekStart(0, mon).toISOString(), new Date('2026-10-19T00:00:00+05:30').toISOString());
  });

  it('flags stores that need a call', () => {
    const base = { status: 'LIVE', orders: 20, missed: 0, rejected: 0, readyCount: 20, late: 0, liveSinceDays: 60 };
    assert.deepEqual(healthFlags(base, 7), []);
    assert.deepEqual(healthFlags({ ...base, missed: 2 }, 7), ['MISSED']);
    assert.deepEqual(healthFlags({ ...base, rejected: 3 }, 7), ['REJECTS']);
    assert.deepEqual(healthFlags({ ...base, late: 5 }, 7), ['SLOW']);
    assert.deepEqual(healthFlags({ ...base, orders: 0, readyCount: 0 }, 7), ['NO_ORDERS']);
  });

  it('small numbers and new stores are not flagged', () => {
    const base = { status: 'LIVE', orders: 4, missed: 4, rejected: 0, readyCount: 0, late: 0, liveSinceDays: 60 };
    assert.deepEqual(healthFlags(base, 7), [], 'fewer than 5 orders');
    assert.deepEqual(healthFlags({ ...base, orders: 0, missed: 0, liveSinceDays: 3 }, 7), [], 'live for only 3 days');
    assert.deepEqual(healthFlags({ ...base, status: 'PAUSED', orders: 0, missed: 0 }, 7), [], 'paused on purpose');
  });
});
