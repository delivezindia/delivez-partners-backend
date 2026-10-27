import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { orderAlert, type AlertOrder } from './ops-alerts';

const now = new Date('2026-10-27T12:00:00Z');
const ago = (m: number) => new Date(now.getTime() - m * 60_000);
const base: AlertOrder = { status: 'PLACED', fulfilmentType: 'DELIVERY', placedAt: now, createdAt: now, acceptedAt: null, readyAt: null, promisedPrepMinutes: null, promisedDeliveryAt: null, currentEtaAt: null, task: null };
const task = (status: string, extra: Partial<NonNullable<AlertOrder['task']>> = {}) => ({ status, assignedAt: null, etaToPickupMin: null, arrivedPickupAt: null, waitingStartedAt: null, arrivedDropAt: null, ...extra });

describe('ops alerts: levels per stage', () => {
  it('accept timer: risk at half, likely at 80%, breached at 3 min', () => {
    assert.equal(orderAlert({ ...base, placedAt: ago(0.5) }, now)!.level, 'NORMAL');
    assert.equal(orderAlert({ ...base, placedAt: ago(1.6) }, now)!.level, 'AT_RISK');
    assert.equal(orderAlert({ ...base, placedAt: ago(2.5) }, now)!.level, 'LIKELY');
    assert.equal(orderAlert({ ...base, placedAt: ago(3) }, now)!.level, 'BREACHED');
  });
  it('prep: +3 risk, +5 likely, +10 breached, with the exact delay in the reason', () => {
    const prep = (late: number) => orderAlert({ ...base, status: 'PREPARING', acceptedAt: ago(20 + late), promisedPrepMinutes: 20 }, now)!;
    assert.equal(prep(2).level, 'NORMAL');
    assert.equal(prep(4).level, 'AT_RISK');
    assert.equal(prep(7).level, 'LIKELY');
    assert.equal(prep(7).reason, 'Prep delayed by +7 min');
    assert.equal(prep(11).level, 'BREACHED');
  });
  it('a rider waiting at the counter makes an on-time kitchen "likely"', () => {
    const a = orderAlert({ ...base, status: 'PREPARING', acceptedAt: ago(10), promisedPrepMinutes: 20, task: task('WAITING_AT_PICKUP', { waitingStartedAt: ago(2) }) }, now)!;
    assert.equal(a.level, 'LIKELY');
    assert.match(a.reason, /Rider waiting 2 min/);
  });
  it('ready with no rider: 10 min = breached', () => {
    assert.equal(orderAlert({ ...base, status: 'READY', readyAt: ago(4), task: task('SEARCHING_RIDER') }, now)!.level, 'AT_RISK');
    assert.equal(orderAlert({ ...base, status: 'READY', readyAt: ago(11), task: task('SEARCHING_RIDER') }, now)!.kind, 'NO_RIDER');
    assert.equal(orderAlert({ ...base, status: 'READY', readyAt: ago(11), task: task('SEARCHING_RIDER') }, now)!.level, 'BREACHED');
  });
  it('rider ETA drifting on the way to the shop', () => {
    const a = orderAlert({ ...base, status: 'READY', readyAt: ago(8), task: task('EN_ROUTE_TO_PICKUP', { assignedAt: ago(12), etaToPickupMin: 6 }) }, now)!;
    assert.equal(a.level, 'LIKELY'); // 6 min behind the rider's ETA
    assert.equal(a.kind, 'RIDER_TO_STORE');
  });
  it('delivery: judged on the promised time, using the live ETA', () => {
    const d = (etaLate: number) => orderAlert({ ...base, status: 'OUT_FOR_DELIVERY', placedAt: ago(30), promisedDeliveryAt: new Date(now.getTime() + 5 * 60_000), currentEtaAt: new Date(now.getTime() + (5 + etaLate) * 60_000) }, now)!;
    assert.equal(d(0).level, 'NORMAL');
    assert.equal(d(4).level, 'AT_RISK');
    assert.equal(d(12).level, 'BREACHED');
  });
  it('door wait and finished orders', () => {
    assert.equal(orderAlert({ ...base, status: 'ARRIVED', task: task('ARRIVED_AT_DROP', { arrivedDropAt: ago(6) }) }, now)!.level, 'LIKELY');
    assert.equal(orderAlert({ ...base, status: 'DELIVERED' }, now), null);
  });
});
