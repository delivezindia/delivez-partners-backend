import { Injectable } from '@nestjs/common';
import type { OrderStatus, Prisma } from '@delivez/db';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminContext } from '../admin/admin.guard';
import { istDate, istDayStart, SOLD } from '../orders/order-reports.service';

const IST_MS = 5.5 * 3600_000;
const NOT_ORDERS: OrderStatus[] = ['DRAFT', 'AWAITING_RX_REVIEW'];
const RUNNING = ['LIVE', 'LIMITED', 'PAUSED'] as const;

/** Monday (IST) of the week `weeksBack` weeks ago, as a UTC instant. */
export function istWeekStart(weeksBack = 0, now = Date.now()) {
  const ist = new Date(now + IST_MS);
  const sinceMonday = (ist.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - sinceMonday - weeksBack * 7) - IST_MS);
}
const weekOf = (d: Date) => istDate(istWeekStart(0, d.getTime()));

/** Store health thresholds (rates need at least this many orders to count). */
export const HEALTH = { minOrders: 5, missedRate: 10, rejectRate: 15, lateRate: 25 } as const;
export type HealthFlag = 'MISSED' | 'REJECTS' | 'SLOW' | 'NO_ORDERS';

export function healthFlags(s: { status: string; orders: number; missed: number; rejected: number; readyCount: number; late: number; liveSinceDays: number | null }, days: number): HealthFlag[] {
  const f: HealthFlag[] = [];
  const pct = (a: number, b: number) => (b ? (a / b) * 100 : 0);
  if (s.orders >= HEALTH.minOrders && pct(s.missed, s.orders) >= HEALTH.missedRate) f.push('MISSED');
  if (s.orders >= HEALTH.minOrders && pct(s.rejected, s.orders) >= HEALTH.rejectRate) f.push('REJECTS');
  if (s.readyCount >= HEALTH.minOrders && pct(s.late, s.readyCount) >= HEALTH.lateRate) f.push('SLOW');
  if (s.status === 'LIVE' && s.orders === 0 && (s.liveSinceDays ?? 0) >= days) f.push('NO_ORDERS');
  return f;
}

const rate = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

/** Admin reports (items 16 & 17): city numbers by week, and stores that need a call. City-scoped. */
@Injectable()
export class AdminReportsService {
  constructor(private readonly prisma: PrismaService) {}

  private realOnly(): Prisma.OrderWhereInput {
    return process.env.NODE_ENV === 'production' ? { isTestOrder: false } : {};
  }
  private storeScope(admin: AdminContext): Prisma.StoreWhereInput {
    return admin.cityIds.length ? { cityId: { in: admin.cityIds } } : {};
  }

  /** Orders that the timeout rejected (the store never answered). */
  private async missedIds(where: Prisma.OrderWhereInput) {
    const rows = await this.prisma.orderStatusEvent.findMany({ where: { toState: 'REJECTED', actorType: 'SYSTEM', order: where }, select: { orderId: true } });
    return new Set(rows.map((r) => r.orderId));
  }

  async cities(admin: AdminContext, weeks: number) {
    const from = istWeekStart(weeks - 1);
    const where: Prisma.OrderWhereInput = { placedAt: { gte: from }, status: { notIn: NOT_ORDERS }, store: this.storeScope(admin), ...this.realOnly() };
    const [orders, missed, live] = await Promise.all([
      this.prisma.order.findMany({ where, select: { id: true, storeId: true, status: true, grandTotal: true, placedAt: true, acceptedAt: true, readyAt: true, store: { select: { cityId: true, city: { select: { name: true } } } } } }),
      this.missedIds(where),
      this.prisma.store.groupBy({ by: ['cityId'], where: { ...this.storeScope(admin), status: { in: [...RUNNING] } }, _count: { _all: true } }),
    ]);
    const weekList = Array.from({ length: weeks }, (_, i) => istDate(istWeekStart(weeks - 1 - i)));
    const cityNames = new Map<string, string>();
    type Acc = { orders: number; sold: number; sales: number; missed: number; prep: number[]; stores: Set<string> };
    const blank = (): Acc => ({ orders: 0, sold: 0, sales: 0, missed: 0, prep: [], stores: new Set() });
    const grid = new Map<string, Map<string, Acc>>(); // cityId → week → numbers
    for (const o of orders) {
      const cityId = o.store.cityId ?? 'none';
      cityNames.set(cityId, o.store.city?.name ?? 'No city');
      const wk = weekOf(o.placedAt!);
      const byWeek = grid.get(cityId) ?? new Map<string, Acc>();
      const a = byWeek.get(wk) ?? blank();
      a.orders++;
      a.stores.add(o.storeId);
      if (SOLD.includes(o.status)) {
        a.sold++;
        a.sales += o.grandTotal;
        if (o.acceptedAt && o.readyAt) a.prep.push((o.readyAt.getTime() - o.acceptedAt.getTime()) / 60_000);
      }
      if (missed.has(o.id)) a.missed++;
      byWeek.set(wk, a);
      grid.set(cityId, byWeek);
    }
    const shape = (a: Acc) => ({ orders: a.orders, sold: a.sold, sales: a.sales, missed: a.missed, missedRate: rate(a.missed, a.orders), avgPrepMinutes: a.prep.length ? Math.round((a.prep.reduce((x, y) => x + y, 0) / a.prep.length) * 10) / 10 : null, storesWithOrders: a.stores.size });
    const merge = (list: Acc[]) => list.reduce((m, a) => ({ orders: m.orders + a.orders, sold: m.sold + a.sold, sales: m.sales + a.sales, missed: m.missed + a.missed, prep: [...m.prep, ...a.prep], stores: new Set([...m.stores, ...a.stores]) }), blank());
    const liveCount = new Map(live.map((l) => [l.cityId ?? 'none', l._count._all]));
    const cities = [...grid.entries()]
      .map(([cityId, byWeek]) => ({
        cityId,
        name: cityNames.get(cityId)!,
        liveStores: liveCount.get(cityId) ?? 0,
        weeks: weekList.map((w) => ({ week: w, ...shape(byWeek.get(w) ?? blank()) })),
        total: shape(merge([...byWeek.values()])),
      }))
      .sort((a, b) => b.total.orders - a.total.orders);
    const allWeeks = weekList.map((w) => ({ week: w, ...shape(merge([...grid.values()].map((m) => m.get(w) ?? blank()))) }));
    return { weeks: weekList, cities, all: { weeks: allWeeks, total: shape(merge([...grid.values()].flatMap((m) => [...m.values()]))) } };
  }

  async citiesCsv(admin: AdminContext, weeks: number) {
    const r = await this.cities(admin, weeks);
    const rs = (p: number) => (p / 100).toFixed(2);
    const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
    const lines = [['City', 'Week starting (Mon)', 'Orders', 'Completed', 'Sales (Rs)', 'Missed', 'Missed %', 'Avg prep (min)', 'Stores with orders'].join(',')];
    for (const c of r.cities) for (const w of c.weeks) lines.push([q(c.name), w.week, w.orders, w.sold, rs(w.sales), w.missed, w.missedRate, w.avgPrepMinutes ?? '', w.storesWithOrders].join(','));
    for (const w of r.all.weeks) lines.push(['All cities', w.week, w.orders, w.sold, rs(w.sales), w.missed, w.missedRate, w.avgPrepMinutes ?? '', w.storesWithOrders].join(','));
    return { filename: `delivez-cities-${weeks}-weeks-${istDate(new Date())}.csv`, body: '﻿' + lines.join('\r\n') + '\r\n' };
  }

  async storeHealth(admin: AdminContext, days: number) {
    const from = istDayStart(days - 1);
    const stores = await this.prisma.store.findMany({
      where: { ...this.storeScope(admin), status: { in: [...RUNNING] } },
      select: { id: true, name: true, vertical: true, status: true, openState: true, phone: true, liveAt: true, city: { select: { name: true } } },
    });
    const ids = stores.map((s) => s.id);
    const where: Prisma.OrderWhereInput = { storeId: { in: ids }, placedAt: { gte: from }, status: { notIn: NOT_ORDERS }, ...this.realOnly() };
    const [orders, missed, last] = await Promise.all([
      this.prisma.order.findMany({ where, select: { id: true, storeId: true, status: true, acceptedAt: true, readyAt: true, promisedPrepMinutes: true } }),
      this.missedIds(where),
      this.prisma.order.groupBy({ by: ['storeId'], where: { storeId: { in: ids }, status: { notIn: NOT_ORDERS }, ...this.realOnly() }, _max: { placedAt: true } }),
    ]);
    const lastAt = new Map(last.map((l) => [l.storeId, l._max.placedAt]));
    const now = Date.now();
    const rows = stores.map((s) => {
      const mine = orders.filter((o) => o.storeId === s.id);
      const m = mine.filter((o) => missed.has(o.id)).length;
      const rejected = mine.filter((o) => o.status === 'REJECTED' && !missed.has(o.id)).length;
      const ready = mine.filter((o) => o.acceptedAt && o.readyAt);
      const late = ready.filter((o) => o.promisedPrepMinutes && o.readyAt!.getTime() - o.acceptedAt!.getTime() > o.promisedPrepMinutes * 60_000).length;
      const prep = ready.map((o) => (o.readyAt!.getTime() - o.acceptedAt!.getTime()) / 60_000);
      const base = { status: s.status, orders: mine.length, missed: m, rejected, readyCount: ready.length, late, liveSinceDays: s.liveAt ? Math.floor((now - s.liveAt.getTime()) / 86_400_000) : null };
      return {
        id: s.id,
        name: s.name,
        city: s.city?.name ?? null,
        vertical: s.vertical,
        status: s.status,
        openState: s.openState,
        phone: s.phone,
        orders: mine.length,
        sold: mine.filter((o) => SOLD.includes(o.status)).length,
        missed: m,
        missedRate: rate(m, mine.length),
        rejected,
        rejectRate: rate(rejected, mine.length),
        cancelled: mine.filter((o) => o.status === 'CANCELLED').length,
        avgPrepMinutes: prep.length ? Math.round((prep.reduce((a, b) => a + b, 0) / prep.length) * 10) / 10 : null,
        lateRate: rate(late, ready.length),
        lastOrderAt: lastAt.get(s.id) ?? null,
        flags: healthFlags(base, days),
      };
    });
    rows.sort((a, b) => b.flags.length - a.flags.length || b.missedRate - a.missedRate || b.rejectRate - a.rejectRate || a.name.localeCompare(b.name));
    return { days, thresholds: HEALTH, stores: rows, counts: { total: rows.length, flagged: rows.filter((r) => r.flags.length).length } };
  }
}
