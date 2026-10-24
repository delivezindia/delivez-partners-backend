import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { localParts } from '../../common/hours';
import { KvService } from '../../common/kv/kv.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { InventoryService } from '../catalog/inventory.service';
import { OrderReportsService } from '../orders/order-reports.service';

const TICK_MS = 5 * 60_000;
/** Morning stock check for shops that track expiry. */
export const EXPIRY_DIGEST_AT = 9 * 60; // 09:00 IST
const EXPIRY_VERTICALS = ['PHARMACY', 'GROCERY', 'LOCAL_STORES'];
/** When a store has no opening hours, its day is summed up at 22:30. */
const SUMMARY_FALLBACK = 22 * 60 + 30;
const RUNNING = ['LIVE', 'LIMITED', 'PAUSED'];
const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

/** When today's summary is due: 15 minutes after the last closing time today, never after 23:45. */
export function summaryDueAt(timings: { dayOfWeek: number; closesAt: string; isClosed: boolean }[], dayOfWeek: number) {
  const today = timings.filter((t) => t.dayOfWeek === dayOfWeek && !t.isClosed);
  if (!timings.length) return SUMMARY_FALLBACK;
  if (!today.length) return null; // closed all day — nothing to sum up
  return Math.min(23 * 60 + 45, Math.max(...today.map((t) => toMin(t.closesAt))) + 15);
}

/**
 * Daily messages to shop owners (items 7 & 8): the 9 AM expiry alert and the end-of-day summary.
 * Each is published as an event; NotificationsService turns it into push + inbox. One of each per store per day.
 */
@Injectable()
export class DigestsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DigestsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly kv: KvService,
    private readonly inventory: InventoryService,
    private readonly reports: OrderReportsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    setTimeout(() => void this.tick(), 20_000);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const { minutes, date, dayOfWeek } = localParts(now, 'Asia/Kolkata');
      const stores = await this.prisma.store.findMany({ where: { status: { in: RUNNING as never } }, select: { id: true, vertical: true, timings: { select: { dayOfWeek: true, closesAt: true, isClosed: true } } } });
      for (const s of stores) {
        if (minutes >= EXPIRY_DIGEST_AT && EXPIRY_VERTICALS.includes(s.vertical)) await this.expiry(s.id, date).catch((e) => this.logger.warn(`expiry ${s.id}: ${(e as Error).message}`));
        const due = summaryDueAt(s.timings, dayOfWeek);
        if (due != null && minutes >= due) await this.summary(s.id, date).catch((e) => this.logger.warn(`summary ${s.id}: ${(e as Error).message}`));
      }
    } catch (e) {
      this.logger.error(`Digests tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Morning alert when stocked items have expired or expire within 30 days. */
  async expiry(storeId: string, date: string, force = false) {
    if (!force && (await this.sent('EXPIRY_ALERT', storeId, date))) return null;
    if (!force && !(await this.kv.setIfAbsent(`digest:expiry:${storeId}:${date}`, '1', 2 * 86_400))) return null;
    const snap = await this.inventory.expirySnapshot(storeId, 30);
    if (!snap.expired && !snap.expiring) return snap;
    await this.publish('inventory.expiry_digest', { storeId, date, expired: snap.expired, expiring: snap.expiring, days: 30 });
    return snap;
  }

  /** End-of-day numbers for the owner. Quiet days (no orders) send nothing. */
  async summary(storeId: string, date: string, force = false) {
    if (!force && (await this.sent('DAILY_SUMMARY', storeId, date))) return null;
    if (!force && !(await this.kv.setIfAbsent(`digest:summary:${storeId}:${date}`, '1', 2 * 86_400))) return null;
    const r = await this.reports.summary(storeId, 1);
    if (!r.orders.total) return r;
    await this.publish('store.daily_summary', { storeId, date, orders: r.orders.total, sold: r.orders.sold, revenue: r.revenue, missed: r.orders.missed, cancelled: r.orders.cancelled });
    return r;
  }

  private async sent(code: string, storeId: string, date: string) {
    const n = await this.prisma.notification.findFirst({ where: { templateCode: code, AND: [{ data: { path: ['storeId'], equals: storeId } }, { data: { path: ['date'], equals: date } }] }, select: { id: true } });
    return !!n;
  }

  private publish(type: string, data: Record<string, unknown>) {
    return this.prisma.$transaction((tx) => this.events.publish(tx, { type, data, actor: { type: 'SYSTEM' } }));
  }
}
