import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { callScript, health, slaMet, suggestions, windowStats, type HealthOrder } from './am-health';

const t0 = new Date('2026-10-20T12:00:00Z');
const at = (m: number) => new Date(t0.getTime() + m * 60_000);
/** Placed at 0, accepted after `accept` min, ready `prep` min after accept, promised `promised`. */
const order = (accept: number, prep: number | null, promised = 20, extra: Partial<HealthOrder> = {}): HealthOrder => ({
  placedAt: t0,
  acceptedAt: at(accept),
  readyAt: prep == null ? null : at(accept + prep),
  promisedPrepMinutes: promised,
  cancelFault: null,
  riderArrivedAt: null,
  ...extra,
});

describe('account manager health: SLA', () => {
  it('on time, slow accept, late ready, store-fault ends', () => {
    assert.equal(slaMet(order(1, 20)), true);
    assert.equal(slaMet(order(4, 20)), false, 'accepted after 3 min');
    assert.equal(slaMet(order(1, 31)), false, 'ready 11 min after the promise');
    assert.equal(slaMet(order(1, 29)), true, '9 min late is inside the grace');
    assert.equal(slaMet({ ...order(0, null), acceptedAt: null, cancelFault: 'STORE' }), false);
    assert.equal(slaMet({ ...order(0, null), acceptedAt: null, cancelFault: 'CUSTOMER' }), null, 'customer cancelled before accept: not judged');
  });
  it('window stats', () => {
    const w = windowStats([order(1, 20), order(1, 30), order(1, 40), { ...order(0, null), acceptedAt: null, cancelFault: 'STORE' }]);
    assert.equal(w.orders, 4);
    assert.equal(w.slaPct, 50); // 2 of 4 met (20 and 30 min), 40 min late fails, store-fault fails
    assert.equal(w.cancelPct, 25);
    assert.equal(w.prepVariance, 10); // (0 + 10 + 20) / 3
  });
  it('rider wait vs food wait', () => {
    const w = windowStats([order(1, 20, 20, { riderArrivedAt: at(11) }), order(1, 20, 20, { riderArrivedAt: at(31) })]);
    assert.equal(w.riderWait, 5); // first: rider came 10 min before ready; second: 0
    assert.equal(w.foodWait, 5); // second: food waited 10 min
  });
});

describe('account manager health: churn risk', () => {
  const good = Array.from({ length: 20 }, () => order(1, 18));
  it('healthy store is stable', () => {
    const h = health({ current: good, previous: good, complaints: 0 });
    assert.equal(h.risk, 0);
    assert.equal(h.badge, 'STABLE');
  });
  it('no orders at all → no data', () => {
    assert.equal(health({ current: [], previous: [], complaints: 0 }).badge, 'NO_DATA');
  });
  it('everything wrong → high risk, weights add up to 100', () => {
    const bad = Array.from({ length: 4 }, () => order(5, 40, 20, { cancelFault: 'STORE' }));
    const h = health({ current: bad, previous: good, complaints: 3 });
    assert.equal(h.risk, 100);
    assert.equal(h.badge, 'HIGH');
    assert.deepEqual(
      h.breakdown.map((b) => b.weight),
      [30, 25, 20, 15, 10],
    );
    assert.equal(h.orderDropPct, 80);
  });
  it('order drop alone puts a store on watch', () => {
    const h = health({ current: good.slice(0, 5), previous: good, complaints: 0 });
    assert.equal(h.orderDropPct, 75);
    assert.equal(h.risk, 25);
    assert.equal(h.badge, 'STABLE');
    const h2 = health({ current: Array.from({ length: 5 }, () => order(1, 30)), previous: good, complaints: 0 }); // 10 min late (inside the SLA grace) + 75% drop = 20 + 25
    assert.equal(h2.badge, 'WATCH');
  });
  it('prep increase flag', () => {
    const h = health({ current: Array.from({ length: 5 }, () => order(1, 28)), previous: Array.from({ length: 5 }, () => order(1, 18)), complaints: 0 });
    assert.ok(h.flags.includes('PREP_UP'));
  });
});

describe('account manager health: suggestions & script', () => {
  it('late kitchen → increase prep, with the SLA it would have had', () => {
    const orders = Array.from({ length: 6 }, () => order(1, 34));
    const h = health({ current: orders, previous: orders, complaints: 0 });
    const s = suggestions(h, orders, 20);
    const up = s.find((x) => x.kind === 'PREP_UP');
    assert.ok(up);
    assert.equal(up.minutes, 10);
    assert.match(up.impact, /0% → 100%/);
  });
  it('early kitchen → reduce prep; drop → visit; complaints → call', () => {
    const orders = Array.from({ length: 6 }, () => order(1, 5, 25));
    const h = health({ current: orders, previous: Array.from({ length: 12 }, () => order(1, 5, 25)), complaints: 2 });
    const kinds = suggestions(h, orders, 25).map((x) => x.kind);
    assert.deepEqual(kinds, ['PREP_DOWN', 'VISIT', 'CALL_COMPLAINTS']);
  });
  it('call script names the biggest factors', () => {
    const orders = Array.from({ length: 4 }, () => order(1, 40));
    const h = health({ current: orders, previous: Array.from({ length: 10 }, () => order(1, 20)), complaints: 0 });
    const lines = callScript(h, 'Meghana Foods', 'Asha');
    assert.match(lines[0], /Asha.*Meghana Foods/);
    assert.ok(lines.some((l) => l.includes('dropped 60%')));
  });
});
