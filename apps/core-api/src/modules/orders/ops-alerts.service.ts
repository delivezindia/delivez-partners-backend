import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { MessagingService } from '../messaging/messaging.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminContext } from '../admin/admin.guard';
import { NotificationsService } from '../notifications/notifications.service';
import { LOGGED, orderAlert, rank, RIDER, ROW_ACTIONS, type AlertLevel } from './ops-alerts';
import { OrderStateService, type OrderActor } from './order-state.service';
import { OrdersService } from './orders.service';

const ACTIVE = ['AWAITING_RX_REVIEW', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_SOON', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED'] as const;
const RIDER_BUSY = ['ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'WAITING_AT_PICKUP', 'PICKED_UP', 'EN_ROUTE_TO_DROP', 'ARRIVED_AT_DROP'] as const;
/** Before pickup a task can go back to the rider search (swap / reduce load / reassign). */
const RELEASABLE = ['ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'WAITING_AT_PICKUP'];
export const ALERT_ACTIONS = ['VIEWED', 'CALLED_STORE', 'CALLED_RIDER', 'PREP_UPDATED', 'ESCALATED', 'RIDER_SWAPPED', 'APOLOGY_SENT'] as const;
export type AlertAction = (typeof ALERT_ACTIONS)[number];
type HistoryItem = { at: string; type: string; level?: string; by?: string; action?: string; note?: string };

const ORDER_SELECT = {
  id: true,
  orderNumber: true,
  status: true,
  fulfilmentType: true,
  isTestOrder: true,
  placedAt: true,
  createdAt: true,
  acceptedAt: true,
  readyAt: true,
  promisedPrepMinutes: true,
  promisedDeliveryAt: true,
  currentEtaAt: true,
  storeId: true,
  store: { select: { id: true, name: true, phone: true, cityId: true, city: { select: { name: true } } } },
  deliveryTask: { select: { id: true, status: true, assignedAt: true, etaToPickupMin: true, arrivedPickupAt: true, waitingStartedAt: true, arrivedDropAt: true, rider: { select: { id: true, user: { select: { fullName: true, phone: true } } } } } },
} satisfies Prisma.OrderSelect;
type Row = Prisma.OrderGetPayload<{ select: typeof ORDER_SELECT }>;

const alertOf = (o: Row, now: Date) =>
  orderAlert(
    {
      status: o.status,
      fulfilmentType: o.fulfilmentType,
      placedAt: o.placedAt,
      createdAt: o.createdAt,
      acceptedAt: o.acceptedAt,
      readyAt: o.readyAt,
      promisedPrepMinutes: o.promisedPrepMinutes,
      promisedDeliveryAt: o.promisedDeliveryAt,
      currentEtaAt: o.currentEtaAt,
      task: o.deliveryTask,
    },
    now,
  );

/**
 * Live ops board: every active order with its alert level, the recorded alerts (acknowledge → action → resolve,
 * kept for ops reviews), the order actions ops take from an alert, and the rider panel.
 */
@Injectable()
export class OpsAlertsService {
  private readonly logger = new Logger(OpsAlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly orders: OrdersService,
    private readonly notifications: NotificationsService,
    private readonly messaging: MessagingService,
  ) {}

  private scope(cityIds: string[]): Prisma.OrderWhereInput {
    return cityIds.length ? { store: { cityId: { in: cityIds } } } : {};
  }

  private async adminName(admin: AdminContext) {
    const u = await this.prisma.user.findUnique({ where: { id: admin.userId }, select: { fullName: true, phone: true } });
    return u?.fullName ?? u?.phone ?? 'Admin';
  }

  // ------------------------------------------------------------------
  // Board
  // ------------------------------------------------------------------

  async board(cityIds: string[], now = new Date()) {
    const rows = await this.prisma.order.findMany({ where: { ...this.scope(cityIds), status: { in: [...ACTIVE] } }, select: ORDER_SELECT, orderBy: { placedAt: 'asc' }, take: 500 });
    const recs = await this.prisma.opsAlert.findMany({ where: { orderId: { in: rows.map((r) => r.id) }, OR: [{ resolvedAt: null }, { resolvedBy: { not: 'System' } }] } });
    // One record per order: an open one beats a resolved one, then the higher level.
    const score = (a: (typeof recs)[number]) => (a.resolvedAt ? 0 : 10) + rank(a.level as AlertLevel);
    const byOrder = new Map<string, (typeof recs)[number]>();
    for (const a of recs) if (!byOrder.has(a.orderId) || score(a) > score(byOrder.get(a.orderId)!)) byOrder.set(a.orderId, a);
    const items = rows.map((o) => {
      const al = alertOf(o, now);
      const level = al?.level ?? 'NORMAL';
      const rec = byOrder.get(o.id);
      const r = o.deliveryTask?.rider;
      return {
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        fulfilmentType: o.fulfilmentType,
        isTestOrder: o.isTestOrder,
        placedAt: o.placedAt,
        store: { id: o.store.id, name: o.store.name, phone: o.store.phone, city: o.store.city?.name ?? null },
        task: o.deliveryTask ? { id: o.deliveryTask.id, status: o.deliveryTask.status } : null,
        rider: r ? { id: r.id, name: r.user.fullName, phone: r.user.phone } : null,
        alert: al ? { level, kind: al.kind, reason: al.reason, deadline: al.deadline, progress: Math.round(al.progress * 100) / 100, behind: al.behind } : { level, kind: null, reason: 'On track', deadline: null, progress: 0, behind: 0 },
        record: rec ? { id: rec.id, level: rec.level, detectedAt: rec.detectedAt, acknowledgedAt: rec.acknowledgedAt, acknowledgedBy: rec.acknowledgedBy, action: rec.action, resolvedAt: rec.resolvedAt, resolvedBy: rec.resolvedBy } : null,
        actions: ROW_ACTIONS[level],
      };
    });
    items.sort((a, b) => rank(b.alert.level) - rank(a.alert.level) || b.alert.progress - a.alert.progress);
    const fiveAgo = new Date(now.getTime() - 5 * 60_000);
    const [breachedRecent, unacked] = await Promise.all([
      this.prisma.opsAlert.count({ where: { breachedAt: { gte: fiveAgo }, ...(cityIds.length ? { cityId: { in: cityIds } } : {}) } }),
      this.prisma.opsAlert.findMany({ where: { resolvedAt: null, acknowledgedAt: null, level: 'BREACHED', ...(cityIds.length ? { cityId: { in: cityIds } } : {}) }, select: { id: true } }),
    ]);
    const count = (l: AlertLevel) => items.filter((i) => i.alert.level === l).length;
    return {
      items,
      summary: { active: items.length, normal: count('NORMAL'), atRisk: count('AT_RISK'), likely: count('LIKELY'), breached: count('BREACHED'), breachedLast5m: breachedRecent, unackedBreached: unacked.map((u) => u.id) },
      serverTime: now,
    };
  }

  // ------------------------------------------------------------------
  // Recording (scheduler, every few seconds)
  // ------------------------------------------------------------------

  /** Open / raise / auto-resolve alerts so detection doesn't depend on someone having the board open. */
  async sync(now = new Date()) {
    const rows = await this.prisma.order.findMany({ where: { status: { in: [...ACTIVE] } }, select: ORDER_SELECT, take: 1000 });
    const open = await this.prisma.opsAlert.findMany({ where: { resolvedAt: null } });
    const closed = await this.prisma.opsAlert.findMany({ where: { orderId: { in: rows.map((o) => o.id) }, resolvedAt: { not: null } }, select: { orderId: true, kind: true, level: true, resolvedBy: true }, orderBy: { resolvedAt: 'desc' } });
    const live = new Map<string, { level: AlertLevel; reason: string }>();
    for (const o of rows) {
      const al = alertOf(o, now);
      if (!al) continue;
      live.set(`${o.id}:${al.kind}`, { level: al.level, reason: al.reason });
      if (!LOGGED.includes(al.level)) continue;
      const rec = open.find((a) => a.orderId === o.id && a.kind === al.kind);
      if (!rec) {
        // The latest closed alert for this stage: if a person resolved it, only a worse level reopens it.
        const done = closed.find((a) => a.orderId === o.id && a.kind === al.kind);
        if (done && done.resolvedBy !== 'System' && rank(al.level) <= rank(done.level as AlertLevel)) continue;
        const history: HistoryItem[] = [{ at: now.toISOString(), type: 'DETECTED', level: al.level }];
        // A new row every time (the old one stays in the audit log); the partial unique index stops doubles.
        await this.prisma.opsAlert
          .create({ data: { orderId: o.id, storeId: o.storeId, cityId: o.store.cityId, kind: al.kind, level: al.level, reason: al.reason, detectedAt: now, breachedAt: al.level === 'BREACHED' ? now : null, history } })
          .catch((e) => this.logger.debug(`alert create ${o.id}: ${(e as Error).message}`));
      } else if (rank(al.level) > rank(rec.level as AlertLevel)) {
        // Likely → breached: new severity, so it has to be acknowledged again.
        await this.prisma.opsAlert.update({
          where: { id: rec.id },
          data: { level: al.level, reason: al.reason, breachedAt: now, acknowledgedAt: null, acknowledgedById: null, acknowledgedBy: null, history: [...((rec.history as HistoryItem[]) ?? []), { at: now.toISOString(), type: 'RAISED', level: al.level }] },
        });
      } else if (rec.reason !== al.reason) {
        await this.prisma.opsAlert.update({ where: { id: rec.id }, data: { reason: al.reason } });
      }
    }
    // Back on track, or the order moved on / ended: resolved.
    for (const rec of open) {
      const now2 = live.get(`${rec.orderId}:${rec.kind}`);
      if (now2 && LOGGED.includes(now2.level)) continue;
      await this.prisma.opsAlert.update({
        where: { id: rec.id },
        data: { resolvedAt: now, resolvedBy: rec.resolvedBy ?? 'System', history: [...((rec.history as HistoryItem[]) ?? []), { at: now.toISOString(), type: 'RESOLVED', by: 'System', note: now2 ? 'Back on track' : 'Order moved on' }] },
      });
    }
  }

  // ------------------------------------------------------------------
  // Acknowledge / act / resolve
  // ------------------------------------------------------------------

  private async mine(id: string, admin: AdminContext) {
    const a = await this.prisma.opsAlert.findUnique({ where: { id } });
    if (!a || (admin.cityIds.length && (!a.cityId || !admin.cityIds.includes(a.cityId)))) throw new ApiError(HttpStatus.NOT_FOUND, 'ALERT_NOT_FOUND', 'Alert not found');
    return a;
  }

  async acknowledge(ids: string[], admin: AdminContext, action?: AlertAction) {
    const by = await this.adminName(admin);
    const now = new Date();
    for (const id of ids) {
      const a = await this.mine(id, admin);
      if (a.resolvedAt) continue;
      const history = [...((a.history as HistoryItem[]) ?? [])];
      if (!a.acknowledgedAt) history.push({ at: now.toISOString(), type: 'ACKNOWLEDGED', by });
      if (action && action !== 'VIEWED') history.push({ at: now.toISOString(), type: 'ACTION', by, action });
      await this.prisma.opsAlert.update({
        where: { id },
        data: { acknowledgedAt: a.acknowledgedAt ?? now, acknowledgedById: a.acknowledgedById ?? admin.adminId, acknowledgedBy: a.acknowledgedBy ?? by, ...(action && action !== 'VIEWED' ? { action, actionAt: now } : {}), history },
      });
    }
    return { acknowledged: ids.length };
  }

  /** Acknowledge every unacknowledged breach in my cities (the red banner's button). */
  async acknowledgeAll(admin: AdminContext) {
    const rows = await this.prisma.opsAlert.findMany({ where: { resolvedAt: null, acknowledgedAt: null, ...(admin.cityIds.length ? { cityId: { in: admin.cityIds } } : {}) }, select: { id: true } });
    return this.acknowledge(rows.map((r) => r.id), admin);
  }

  async resolve(id: string, admin: AdminContext, note?: string) {
    const a = await this.mine(id, admin);
    if (a.resolvedAt) return a;
    const by = await this.adminName(admin);
    const now = new Date();
    return this.prisma.opsAlert.update({
      where: { id },
      data: { resolvedAt: now, resolvedBy: by, acknowledgedAt: a.acknowledgedAt ?? now, acknowledgedBy: a.acknowledgedBy ?? by, acknowledgedById: a.acknowledgedById ?? admin.adminId, history: [...((a.history as HistoryItem[]) ?? []), { at: now.toISOString(), type: 'RESOLVED', by, note }] },
    });
  }

  /** Audit log for ops reviews. */
  async log(admin: AdminContext, q: { from?: Date; level?: string; limit: number }) {
    const rows = await this.prisma.opsAlert.findMany({
      where: { ...(admin.cityIds.length ? { cityId: { in: admin.cityIds } } : {}), ...(q.from ? { detectedAt: { gte: q.from } } : {}), ...(q.level ? { level: q.level } : {}) },
      orderBy: { detectedAt: 'desc' },
      take: q.limit,
    });
    const orders = await this.prisma.order.findMany({ where: { id: { in: rows.map((r) => r.orderId) } }, select: { id: true, orderNumber: true, store: { select: { name: true } } } });
    const ord = new Map(orders.map((o) => [o.id, o]));
    return {
      items: rows.map((r) => ({
        ...r,
        orderNumber: ord.get(r.orderId)?.orderNumber ?? null,
        store: ord.get(r.orderId)?.store.name ?? null,
        ackSeconds: r.acknowledgedAt ? Math.round((r.acknowledgedAt.getTime() - r.detectedAt.getTime()) / 1000) : null,
      })),
    };
  }

  // ------------------------------------------------------------------
  // Actions from an alert
  // ------------------------------------------------------------------

  private async order(orderId: string, cityIds: string[]) {
    const o = await this.prisma.order.findFirst({ where: { id: orderId, ...this.scope(cityIds) }, include: { store: { select: { name: true, cityId: true } }, customer: { include: { user: { select: { id: true, phone: true, fullName: true } } } }, deliveryTask: true } });
    if (!o) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    return o;
  }

  private async recordAction(orderId: string, admin: AdminContext, action: AlertAction) {
    const open = await this.prisma.opsAlert.findMany({ where: { orderId, resolvedAt: null }, select: { id: true } });
    if (open.length) await this.acknowledge(open.map((a) => a.id), admin, action);
  }

  /** Ops updates the prep time from the board (same rules as the shop's "Delay"). */
  async updatePrep(orderId: string, minutes: number, reason: string, admin: AdminContext, actor: OrderActor) {
    const o = await this.order(orderId, admin.cityIds);
    const view = await this.orders.delay(o.storeId, orderId, minutes, reason, actor);
    await this.recordAction(orderId, admin, 'PREP_UPDATED');
    return view;
  }

  /** Breach escalation: city leads and the head of ops are alerted. */
  async escalate(orderId: string, note: string | undefined, admin: AdminContext) {
    const o = await this.order(orderId, admin.cityIds);
    const by = await this.adminName(admin);
    const leads = await this.prisma.adminUser.findMany({
      where: { isActive: true, role: { in: ['HEAD_OF_OPS', 'REGIONAL_HEAD'] }, id: { not: admin.adminId }, ...(o.store.cityId ? { OR: [{ cityIds: { isEmpty: true } }, { cityIds: { has: o.store.cityId } }] } : {}) },
      select: { user: { select: { id: true, language: true } } },
    });
    await this.notifications.deliver(null, leads.map((l) => ({ userId: l.user.id, language: l.user.language })), {
      app: 'ADMIN',
      code: 'OPS_ESCALATED',
      vars: { orderNumber: o.orderNumber, store: o.store.name, by, note },
      url: `/orders?q=${o.orderNumber}`,
      tag: `esc-${o.id}`,
      urgent: true,
      storeId: o.storeId,
    });
    await this.recordAction(orderId, admin, 'ESCALATED');
    return { escalatedTo: leads.length };
  }

  /** Swap rider: the task goes back to the rider search (only before pickup); ops then assigns the next rider. */
  async releaseRider(taskId: string, admin: AdminContext, actor: OrderActor) {
    const t = await this.prisma.deliveryTask.findUnique({ where: { id: taskId } });
    if (!t?.orderId) throw new ApiError(HttpStatus.NOT_FOUND, 'TASK_NOT_FOUND', 'Delivery task not found');
    await this.order(t.orderId, admin.cityIds);
    if (!RELEASABLE.includes(t.status)) throw new ApiError(HttpStatus.CONFLICT, 'TASK_NOT_RELEASABLE', t.status === 'PICKED_UP' || t.status.includes('DROP') ? 'The rider already has the food — it can’t be swapped now' : 'No rider to swap yet');
    await this.prisma.$transaction((tx) => this.state.setTask(tx, t, 'SEARCHING_RIDER', { rider: { disconnect: true }, assignedAt: null, arrivedPickupAt: null, waitingStartedAt: null, searchStartedAt: new Date() }, actor.kind));
    await this.recordAction(t.orderId, admin, 'RIDER_SWAPPED');
    return { taskId, status: 'SEARCHING_RIDER' };
  }

  /** "Sorry, running late" to the customer — once per order. */
  async apologise(orderId: string, admin: AdminContext, actor: OrderActor) {
    const o = await this.order(orderId, admin.cityIds);
    const phone = o.customer?.user.phone;
    if (!phone) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'NO_CUSTOMER_PHONE', 'No phone number on this order');
    const sent = await this.prisma.orderStatusEvent.findFirst({ where: { orderId, meta: { path: ['apology'], equals: true } } });
    if (sent) throw new ApiError(HttpStatus.CONFLICT, 'APOLOGY_ALREADY_SENT', 'An apology was already sent for this order');
    const body = `Delivez: Sorry — your order ${o.orderNumber} from ${o.store.name} is running late. We're on it and will get it to you as soon as possible.`;
    await this.messaging.send({ channel: 'SMS', to: phone, userId: o.customer!.user.id, template: 'ORDER_APOLOGY', body, vars: { orderNumber: o.orderNumber, store: o.store.name } });
    await this.prisma.$transaction((tx) => this.state.note(tx, o, 'order.apology_sent', actor, 'Apology sent to the customer', { apology: true }));
    await this.recordAction(orderId, admin, 'APOLOGY_SENT');
    return { sent: true };
  }

  // ------------------------------------------------------------------
  // Rider panel
  // ------------------------------------------------------------------

  async riders(cityIds: string[], now = new Date()) {
    const riders = await this.prisma.rider.findMany({
      where: { status: { in: ['ACTIVE', 'OFFLINE'] }, OR: [...(cityIds.length ? [{ cityId: { in: cityIds } }] : [{}]), { tasks: { some: { status: { in: [...RIDER_BUSY] }, order: this.scope(cityIds) } } }] },
      include: { user: { select: { fullName: true, phone: true } }, tasks: { where: { status: { in: [...RIDER_BUSY] } }, select: { id: true, status: true, assignedAt: true, order: { select: { id: true, orderNumber: true, store: { select: { name: true } } } } }, orderBy: { assignedAt: 'asc' } } },
      take: 300,
    });
    const items = riders.map((r) => {
      const load = r.tasks.length;
      const stale = r.lastSeenAt ? now.getTime() - r.lastSeenAt.getTime() > RIDER.OFFLINE_AFTER_MINUTES * 60_000 : false;
      const offline = load > 0 && !r.pausedAt && (!r.isOnline || stale);
      const state = offline ? 'OFFLINE' : load >= RIDER.OVERLOADED_TASKS ? 'OVERLOADED' : r.pausedAt ? 'PAUSED' : load ? 'BUSY' : r.isOnline ? 'FREE' : 'OFF';
      return { id: r.id, code: r.riderCode, name: r.user.fullName, phone: r.user.phone, isOnline: r.isOnline, pausedAt: r.pausedAt, lastSeenAt: r.lastSeenAt, load, state, tasks: r.tasks.map((t) => ({ id: t.id, status: t.status, orderId: t.order?.id, orderNumber: t.order?.orderNumber, store: t.order?.store.name, releasable: RELEASABLE.includes(t.status) })) };
    });
    const order = { OFFLINE: 0, OVERLOADED: 1, BUSY: 2, PAUSED: 3, FREE: 4, OFF: 5 } as Record<string, number>;
    items.sort((a, b) => order[a.state] - order[b.state] || b.load - a.load);
    return { items };
  }

  async pauseRider(riderId: string, pause: boolean) {
    const r = await this.prisma.rider.findUnique({ where: { id: riderId } });
    if (!r) throw new ApiError(HttpStatus.NOT_FOUND, 'RIDER_NOT_FOUND', 'Rider not found');
    await this.prisma.rider.update({ where: { id: riderId }, data: { pausedAt: pause ? new Date() : null } });
    return { riderId, paused: pause };
  }

  /** Reassign: every task not yet picked up (rider offline) or just the latest one (reduce load). */
  async reassign(riderId: string, mode: 'ALL' | 'ONE', admin: AdminContext, actor: OrderActor) {
    const tasks = await this.prisma.deliveryTask.findMany({ where: { riderId, status: { in: RELEASABLE as never[] } }, orderBy: { assignedAt: 'desc' } });
    const pick = mode === 'ONE' ? tasks.slice(0, 1) : tasks;
    if (!pick.length) throw new ApiError(HttpStatus.CONFLICT, 'NOTHING_TO_REASSIGN', 'No orders to reassign — the rider has already picked up the rest');
    for (const t of pick) await this.releaseRider(t.id, admin, actor);
    return { released: pick.length };
  }
}
