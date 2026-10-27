import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { EventBus, type DomainEvent } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES, type AdminContext } from '../admin/admin.guard';
import { assertCityScope } from '../admin/store-lifecycle.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SimulatorService } from '../orders/simulator.service';
import { callScript, health, PREP_MAX, PREP_MIN, PREP_STEP_MAX, RISK, suggestions, WINDOW_DAYS, type Health, type HealthOrder, type SuggestionKind } from './am-health';

const DAY = 86_400_000;
const IST = 5.5 * 3_600_000;
/** Start of today in India, as a UTC instant. */
const istMidnight = (now = new Date()) => new Date(Math.floor((now.getTime() + IST) / DAY) * DAY - IST);
const istDate = (d: Date) => new Date(d.getTime() + IST).toISOString().slice(0, 10);
const HOURLY_MS = 60 * 60_000;

/** Issue SLA timers: how long the AM / ops have to handle each kind. */
const ISSUE_DUE_MINUTES: Record<string, number> = { PREP_DELAY: 30, RIDER_DELAY: 30, COMPLAINT: 24 * 60, ORDER_DROP: 24 * 60, CHURN_RISK: 24 * 60 };
const SLA_KIND: Record<string, { kind: string; label: string }> = {
  PREP_LATE: { kind: 'PREP_DELAY', label: 'running late in the kitchen' },
  PREP_STUCK: { kind: 'PREP_DELAY', label: 'stuck in the kitchen' },
  NO_RIDER: { kind: 'RIDER_DELAY', label: 'ready with no rider' },
  DOOR_WAIT: { kind: 'RIDER_DELAY', label: 'rider waiting at the door' },
};

type StoreRow = {
  id: string;
  name: string;
  vertical: string;
  storeType: string;
  cuisines: string[];
  phone: string | null;
  cityId: string | null;
  openState: string;
  defaultPrepMinutes: number;
  addressLine1: string | null;
  city: { name: string } | null;
};
const STORE_SELECT = {
  id: true,
  name: true,
  vertical: true,
  storeType: true,
  cuisines: true,
  phone: true,
  cityId: true,
  openState: true,
  defaultPrepMinutes: true,
  addressLine1: true,
  city: { select: { name: true } },
} satisfies Prisma.StoreSelect;

/**
 * Account managers (role ACCOUNT_MANAGER) look after a book of stores: health, churn risk, issues,
 * follow-ups and a communication log. An AM only ever sees the stores assigned to them; the only store
 * setting they can change is the default prep time (±10 min per change, 5–90 min).
 */
@Injectable()
export class AmService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AmService.name);
  private timer?: NodeJS.Timeout;
  private first?: NodeJS.Timeout;
  private unsubscribe: (() => void)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly notifications: NotificationsService,
    private readonly simulator: SimulatorService,
  ) {}

  onModuleInit() {
    this.unsubscribe.push(this.events.subscribe('order.sla_breach', (e) => this.onSlaBreach(e)));
    this.unsubscribe.push(this.events.subscribe('order.return_created', (e) => this.onReturn(e)));
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    this.first = setTimeout(() => void this.healthCheck(), 60_000);
    this.timer = setInterval(() => void this.healthCheck(), HOURLY_MS);
  }

  onModuleDestroy() {
    this.unsubscribe.forEach((u) => u());
    clearTimeout(this.first);
    clearInterval(this.timer);
  }

  // ------------------------------------------------------------------
  // Health
  // ------------------------------------------------------------------

  private async healthOf(storeIds: string[], now = new Date()) {
    const since = new Date(now.getTime() - 2 * WINDOW_DAYS * DAY);
    const split = new Date(now.getTime() - WINDOW_DAYS * DAY);
    const [orders, reviews, returns, tickets] = await Promise.all([
      this.prisma.order.findMany({
        where: { storeId: { in: storeIds }, isTestOrder: false, status: { not: 'DRAFT' }, placedAt: { gte: since } },
        select: { storeId: true, placedAt: true, acceptedAt: true, readyAt: true, promisedPrepMinutes: true, cancelFault: true, deliveryTask: { select: { arrivedPickupAt: true } } },
      }),
      this.prisma.review.groupBy({ by: ['storeId'], where: { storeId: { in: storeIds }, rating: { lte: 2 }, createdAt: { gte: split } }, _count: true }),
      this.prisma.orderReturn.findMany({
        where: { order: { storeId: { in: storeIds } }, reason: { not: 'UNDELIVERED' }, createdAt: { gte: split } },
        select: { orderId: true, order: { select: { storeId: true } } },
      }),
      this.prisma.supportTicket.groupBy({ by: ['storeId'], where: { storeId: { in: storeIds }, raisedByType: 'CUSTOMER', createdAt: { gte: split } }, _count: true }),
    ]);
    const complaints = new Map<string, number>();
    const add = (id: string | null, n: number) => id && complaints.set(id, (complaints.get(id) ?? 0) + n);
    reviews.forEach((r) => add(r.storeId, r._count));
    tickets.forEach((t) => add(t.storeId, t._count));
    // One complaint per order, however many items came back.
    [...new Map(returns.map((r) => [r.orderId, r.order.storeId])).values()].forEach((s) => add(s, 1));

    const byStore = new Map<string, { cur: (HealthOrder & { at: Date })[]; prev: HealthOrder[] }>(storeIds.map((id) => [id, { cur: [], prev: [] }]));
    for (const o of orders) {
      const h: HealthOrder & { at: Date } = {
        at: o.placedAt!,
        placedAt: o.placedAt!,
        acceptedAt: o.acceptedAt,
        readyAt: o.readyAt,
        promisedPrepMinutes: o.promisedPrepMinutes,
        cancelFault: o.cancelFault,
        riderArrivedAt: o.deliveryTask?.arrivedPickupAt ?? null,
      };
      const b = byStore.get(o.storeId)!;
      (o.placedAt! >= split ? b.cur : b.prev).push(h);
    }
    return new Map([...byStore].map(([id, b]) => [id, { health: health({ current: b.cur, previous: b.prev, complaints: complaints.get(id) ?? 0 }), orders: b.cur }]));
  }

  private async myStores(admin: AdminContext, storeId?: string) {
    const rows: StoreRow[] = await this.prisma.store.findMany({ where: { accountManagerId: admin.adminId, ...(storeId ? { id: storeId } : {}) }, select: STORE_SELECT, orderBy: { name: 'asc' } });
    if (storeId && !rows.length) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_ASSIGNED', 'This store isn’t assigned to you');
    return rows;
  }

  private card(s: StoreRow, h: Health, openIssues: number) {
    return {
      id: s.id,
      name: s.name,
      vertical: s.vertical,
      category: s.cuisines.length ? s.cuisines.slice(0, 3).join(', ') : s.storeType.replace(/_/g, ' ').toLowerCase(),
      phone: s.phone,
      area: s.city?.name ?? null,
      openState: s.openState,
      slaPct: h.current.slaPct,
      slaTrend: h.slaTrend,
      orders7d: h.current.orders,
      risk: h.risk,
      badge: h.badge,
      openIssues,
    };
  }

  private async openIssueCounts(storeIds: string[]) {
    const rows = await this.prisma.amIssue.groupBy({ by: ['storeId'], where: { storeId: { in: storeIds }, status: { not: 'RESOLVED' } }, _count: true });
    return new Map(rows.map((r) => [r.storeId, r._count]));
  }

  async home(admin: AdminContext) {
    const [me, stores] = await Promise.all([
      this.prisma.adminUser.findUniqueOrThrow({ where: { id: admin.adminId }, select: { user: { select: { fullName: true, phone: true } }, cityIds: true } }),
      this.myStores(admin),
    ]);
    const ids = stores.map((s) => s.id);
    const now = new Date();
    const [hm, issues, ordersToday, tasksDue, cities] = await Promise.all([
      this.healthOf(ids, now),
      this.openIssueCounts(ids),
      this.prisma.order.count({ where: { storeId: { in: ids }, isTestOrder: false, status: { not: 'DRAFT' }, placedAt: { gte: istMidnight(now) } } }),
      this.prisma.amTask.count({ where: { adminId: admin.adminId, doneAt: null, dueAt: { lt: new Date(istMidnight(now).getTime() + DAY) } } }),
      this.prisma.city.findMany({ where: { id: { in: me.cityIds } }, select: { name: true } }),
    ]);
    const cards = stores.map((s) => this.card(s, hm.get(s.id)!.health, issues.get(s.id) ?? 0));
    const sla = cards.map((c) => c.slaPct).filter((x): x is number => x != null);
    const high = cards.filter((c) => c.badge === 'HIGH');
    return {
      am: { name: me.user.fullName ?? me.user.phone, zone: me.cityIds.length ? cities.map((c) => c.name).join(', ') : 'All cities' },
      kpis: {
        assigned: cards.length,
        active7d: cards.filter((c) => c.orders7d > 0).length,
        avgSla: sla.length ? Math.round(sla.reduce((a, b) => a + b, 0) / sla.length) : null,
        highRisk: high.length,
        watch: cards.filter((c) => c.badge === 'WATCH').length,
        ordersToday,
        openIssues: [...issues.values()].reduce((a, b) => a + b, 0),
        tasksDue,
      },
      atRisk: cards
        .filter((c) => c.badge === 'HIGH' || c.badge === 'WATCH')
        .sort((a, b) => (b.risk ?? 0) - (a.risk ?? 0))
        .slice(0, 5),
      syncedAt: now,
    };
  }

  async list(admin: AdminContext, sort: 'risk' | 'sla' | 'orders' | 'name') {
    const stores = await this.myStores(admin);
    const ids = stores.map((s) => s.id);
    const [hm, issues] = await Promise.all([this.healthOf(ids), this.openIssueCounts(ids)]);
    const cards = stores.map((s) => this.card(s, hm.get(s.id)!.health, issues.get(s.id) ?? 0));
    const by = {
      risk: (a: (typeof cards)[number], b: (typeof cards)[number]) => (b.risk ?? -1) - (a.risk ?? -1),
      sla: (a: (typeof cards)[number], b: (typeof cards)[number]) => (a.slaPct ?? 101) - (b.slaPct ?? 101),
      orders: (a: (typeof cards)[number], b: (typeof cards)[number]) => b.orders7d - a.orders7d,
      name: (a: (typeof cards)[number], b: (typeof cards)[number]) => a.name.localeCompare(b.name),
    }[sort];
    return { stores: cards.sort(by), syncedAt: new Date() };
  }

  async detail(admin: AdminContext, storeId: string) {
    const [store] = await this.myStores(admin, storeId);
    const now = new Date();
    const { health: h, orders } = (await this.healthOf([storeId], now)).get(storeId)!;
    const [issues, activity, tasks, me] = await Promise.all([
      this.prisma.amIssue.findMany({ where: { storeId, status: { not: 'RESOLVED' } }, orderBy: { dueAt: 'asc' } }),
      this.prisma.amActivity.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' }, take: 30, include: { admin: { select: { user: { select: { fullName: true } } } } } }),
      this.prisma.amTask.findMany({ where: { storeId, doneAt: null }, orderBy: { dueAt: 'asc' } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: admin.userId }, select: { fullName: true } }),
    ]);
    // Daily series for the mini charts (India days, oldest first).
    const days = Array.from({ length: WINDOW_DAYS }, (_, i) => istDate(new Date(now.getTime() - (WINDOW_DAYS - 1 - i) * DAY)));
    const avg = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
    const series = days.map((d) => {
      const os = orders.filter((o) => istDate(o.at) === d);
      const timed = os.filter((o) => o.acceptedAt && o.readyAt && o.promisedPrepMinutes != null && o.readyAt >= o.acceptedAt);
      const rider = os.filter((o) => o.readyAt && o.riderArrivedAt);
      return {
        date: d,
        orders: os.length,
        promised: avg(timed.map((o) => o.promisedPrepMinutes!)),
        actual: avg(timed.map((o) => (o.readyAt!.getTime() - o.acceptedAt!.getTime()) / 60_000)),
        riderVsReady: avg(rider.map((o) => (o.riderArrivedAt!.getTime() - o.readyAt!.getTime()) / 60_000)),
      };
    });
    return {
      store: {
        ...this.card(store, h, issues.length),
        address: store.addressLine1,
        prepMinutes: store.defaultPrepMinutes,
        prepLimits: { min: Math.max(PREP_MIN, store.defaultPrepMinutes - PREP_STEP_MAX), max: Math.min(PREP_MAX, store.defaultPrepMinutes + PREP_STEP_MAX) },
      },
      health: h,
      series,
      suggestions: suggestions(h, orders, store.defaultPrepMinutes),
      script: callScript(h, store.name, me.fullName?.split(/\s+/)[0] ?? 'your account manager'),
      issues,
      tasks,
      activity: activity.map((a) => ({ id: a.id, kind: a.kind, note: a.note, meta: a.meta, at: a.createdAt, by: a.admin.user.fullName })),
      syncedAt: now,
    };
  }

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  async log(admin: AdminContext, storeId: string, input: { kind: string; note?: string; clientId?: string; at?: Date }) {
    await this.myStores(admin, storeId);
    if (input.clientId) {
      const seen = await this.prisma.amActivity.findUnique({ where: { clientId: input.clientId } });
      if (seen) return seen;
    }
    return this.prisma.amActivity.create({
      data: { adminId: admin.adminId, storeId, kind: input.kind, note: input.note, clientId: input.clientId, ...(input.at && input.at < new Date() ? { createdAt: input.at } : {}) },
    });
  }

  /** The one store setting an AM may change. The shop is told. */
  async setPrep(admin: AdminContext, storeId: string, minutes: number, reason?: string) {
    const [store] = await this.myStores(admin, storeId);
    const from = store.defaultPrepMinutes;
    if (minutes === from) return { prepMinutes: from };
    if (minutes < PREP_MIN || minutes > PREP_MAX) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'PREP_OUT_OF_RANGE', `Prep time must be between ${PREP_MIN} and ${PREP_MAX} minutes`);
    if (Math.abs(minutes - from) > PREP_STEP_MAX) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'PREP_STEP_TOO_BIG', `You can change prep time by up to ${PREP_STEP_MAX} minutes at a time`);
    await this.prisma.$transaction(async (tx) => {
      await tx.store.update({ where: { id: storeId }, data: { defaultPrepMinutes: minutes } });
      await tx.adminAction.create({ data: { adminId: admin.adminId, storeId, type: 'FORCE_ETA_OVERRIDE', params: { defaultPrepMinutes: { from, to: minutes } }, reason } });
      await tx.amActivity.create({ data: { adminId: admin.adminId, storeId, kind: 'PREP_CHANGED', note: reason, meta: { from, to: minutes } } });
      await this.events.publish(tx, {
        type: 'store.admin_notice',
        data: {
          storeId,
          noticeId: `prep-${storeId}-${Date.now()}`,
          message: `Your default prep time was changed from ${from} to ${minutes} minutes by your Delivez account manager${reason ? ` — ${reason}` : ''}.`,
        },
        actor: { type: 'ADMIN', userId: admin.userId, role: admin.role },
      });
    });
    return { prepMinutes: minutes };
  }

  async apply(admin: AdminContext, storeId: string, kind: SuggestionKind) {
    const d = await this.detail(admin, storeId);
    const s = d.suggestions.find((x) => x.kind === kind);
    if (!s) throw new ApiError(HttpStatus.CONFLICT, 'SUGGESTION_GONE', 'This suggestion no longer applies — the numbers have changed');
    const tomorrow11 = new Date(istMidnight().getTime() + DAY + 11 * 3_600_000 - 0);
    switch (kind) {
      case 'PREP_UP':
      case 'PREP_DOWN':
        return { done: 'PREP', ...(await this.setPrep(admin, storeId, d.store.prepMinutes + (s.minutes ?? 0), s.title)) };
      case 'ESCALATE_RIDERS': {
        const issue = await this.raise(storeId, {
          kind: 'RIDER_DELAY',
          title: `Food waits for riders (${d.health.current.foodWait} min avg)`,
          dedupeKey: `riders:${storeId}:${istDate(new Date())}`,
          owner: 'OPS',
          status: 'ESCALATED',
          note: s.impact,
        });
        await this.log(admin, storeId, { kind: 'ISSUE_ESCALATED', note: issue.title });
        if (issue.fresh) await this.tellOps(storeId, issue.title);
        return { done: 'ESCALATED', issueId: issue.id };
      }
      case 'VISIT':
        return { done: 'TASK', task: await this.addTask(admin, storeId, { kind: 'VISIT', title: s.title, priority: 'HIGH', dueAt: tomorrow11, source: 'SUGGESTION' }) };
      default:
        return { done: 'TASK', task: await this.addTask(admin, storeId, { kind: 'CALL', title: s.title, priority: 'HIGH', dueAt: new Date(Date.now() + 2 * 3_600_000), source: 'SUGGESTION' }) };
    }
  }

  async testOrder(admin: AdminContext, storeId: string) {
    await this.myStores(admin, storeId);
    const res = (await this.simulator.simulate(storeId, { count: 1, fulfilment: 'DELIVERY', payment: 'UPI', placedSecondsAgo: 0 }, { kind: 'ADMIN', userId: admin.userId, role: admin.role })) as
      { orders?: { orderNumber: string }[] } | { orderNumber: string }[];
    const list = Array.isArray(res) ? res : (res.orders ?? []);
    await this.log(admin, storeId, { kind: 'TEST_ORDER', note: list[0] ? `Test order ${list[0].orderNumber}` : 'Test order placed' });
    return { orderNumber: list[0]?.orderNumber ?? null };
  }

  // ---- Tasks

  async addTask(admin: AdminContext, storeId: string, t: { kind: string; title: string; priority: string; dueAt: Date; source?: string }) {
    await this.myStores(admin, storeId);
    return this.prisma.amTask.create({ data: { adminId: admin.adminId, storeId, kind: t.kind, title: t.title, priority: t.priority, dueAt: t.dueAt, source: t.source ?? 'MANUAL' } });
  }

  async tasks(admin: AdminContext, tab: 'today' | 'overdue' | 'upcoming' | 'done') {
    const now = new Date();
    const start = istMidnight(now);
    const end = new Date(start.getTime() + DAY);
    const where: Prisma.AmTaskWhereInput = {
      adminId: admin.adminId,
      ...(tab === 'done' ? { doneAt: { not: null } } : { doneAt: null }),
      ...(tab === 'overdue' ? { dueAt: { lt: now } } : tab === 'today' ? { dueAt: { gte: now, lt: end } } : tab === 'upcoming' ? { dueAt: { gte: end } } : {}),
    };
    const [rows, counts] = await Promise.all([
      this.prisma.amTask.findMany({ where, orderBy: tab === 'done' ? { doneAt: 'desc' } : [{ dueAt: 'asc' }], take: 100, include: { store: { select: { id: true, name: true, phone: true } } } }),
      Promise.all([
        this.prisma.amTask.count({ where: { adminId: admin.adminId, doneAt: null, dueAt: { gte: now, lt: end } } }),
        this.prisma.amTask.count({ where: { adminId: admin.adminId, doneAt: null, dueAt: { lt: now } } }),
      ]),
    ]);
    const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as Record<string, number>;
    if (tab !== 'done') rows.sort((a, b) => (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1) || a.dueAt.getTime() - b.dueAt.getTime());
    return { tasks: rows, counts: { today: counts[0], overdue: counts[1] } };
  }

  async completeTask(admin: AdminContext, taskId: string, note?: string) {
    const t = await this.prisma.amTask.findFirst({ where: { id: taskId, adminId: admin.adminId } });
    if (!t) throw new ApiError(HttpStatus.NOT_FOUND, 'TASK_NOT_FOUND', 'Task not found');
    if (t.doneAt) return t;
    const [done] = await this.prisma.$transaction([
      this.prisma.amTask.update({ where: { id: t.id }, data: { doneAt: new Date() } }),
      this.prisma.amActivity.create({ data: { adminId: admin.adminId, storeId: t.storeId, kind: 'TASK_DONE', note: note ? `${t.title} — ${note}` : t.title } }),
    ]);
    return done;
  }

  // ---- Issues

  async issues(admin: AdminContext, status: 'open' | 'resolved') {
    const rows = await this.prisma.amIssue.findMany({
      where: { store: { accountManagerId: admin.adminId }, status: status === 'open' ? { not: 'RESOLVED' } : 'RESOLVED' },
      orderBy: status === 'open' ? { dueAt: 'asc' } : { resolvedAt: 'desc' },
      take: 100,
      include: { store: { select: { id: true, name: true, phone: true } } },
    });
    return { issues: rows };
  }

  private async myIssue(admin: AdminContext, issueId: string) {
    const i = await this.prisma.amIssue.findFirst({ where: { id: issueId, store: { accountManagerId: admin.adminId } } });
    if (!i) throw new ApiError(HttpStatus.NOT_FOUND, 'ISSUE_NOT_FOUND', 'Issue not found');
    return i;
  }

  async escalate(admin: AdminContext, issueId: string, note?: string) {
    const i = await this.myIssue(admin, issueId);
    if (i.status !== 'OPEN') throw new ApiError(HttpStatus.CONFLICT, 'ISSUE_NOT_OPEN', i.status === 'ESCALATED' ? 'Already with ops' : 'Already resolved');
    const row = await this.prisma.amIssue.update({ where: { id: i.id }, data: { status: 'ESCALATED', owner: 'OPS', note: note ?? i.note } });
    await this.log(admin, i.storeId, { kind: 'ISSUE_ESCALATED', note: note ? `${i.title} — ${note}` : i.title });
    await this.tellOps(i.storeId, i.title);
    return row;
  }

  async resolve(admin: AdminContext, issueId: string, note?: string) {
    const i = await this.myIssue(admin, issueId);
    if (i.status === 'RESOLVED') return i;
    const row = await this.prisma.amIssue.update({ where: { id: i.id }, data: { status: 'RESOLVED', resolvedAt: new Date(), resolvedByAdminId: admin.adminId, note: note ?? i.note } });
    await this.log(admin, i.storeId, { kind: 'ISSUE_RESOLVED', note: note ? `${i.title} — ${note}` : i.title });
    return row;
  }

  // ------------------------------------------------------------------
  // Assignment (city ops and above)
  // ------------------------------------------------------------------

  async managers(admin: AdminContext) {
    const rows = await this.prisma.adminUser.findMany({
      where: { role: 'ACCOUNT_MANAGER', isActive: true, ...(admin.cityIds.length ? { OR: [{ cityIds: { isEmpty: true } }, { cityIds: { hasSome: admin.cityIds } }] } : {}) },
      select: { id: true, cityIds: true, user: { select: { fullName: true, phone: true } }, _count: { select: { accountStores: true } } },
    });
    return rows.map((r) => ({ id: r.id, name: r.user.fullName ?? r.user.phone, phone: r.user.phone, cityIds: r.cityIds, stores: r._count.accountStores }));
  }

  async assign(admin: AdminContext, storeId: string, managerId: string | null) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { cityId: true } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    assertCityScope(admin, store.cityId);
    if (managerId) {
      const am = await this.prisma.adminUser.findUnique({ where: { id: managerId } });
      if (!am || am.role !== 'ACCOUNT_MANAGER' || !am.isActive) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'NOT_AN_ACCOUNT_MANAGER', 'Pick an active account manager');
      if (am.cityIds.length && (!store.cityId || !am.cityIds.includes(store.cityId)))
        throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'AM_CITY_MISMATCH', 'This account manager doesn’t cover the store’s city');
    }
    await this.prisma.store.update({ where: { id: storeId }, data: { accountManagerId: managerId } });
    return { storeId, accountManagerId: managerId };
  }

  // ------------------------------------------------------------------
  // Issues raised by the system + alerts
  // ------------------------------------------------------------------

  private async raise(storeId: string, i: { kind: string; title: string; dedupeKey: string; orderId?: string; owner?: string; status?: string; note?: string }) {
    const existing = await this.prisma.amIssue.findUnique({ where: { dedupeKey: i.dedupeKey } });
    if (existing) return { ...existing, fresh: false };
    const row = await this.prisma.amIssue
      .create({
        data: {
          storeId,
          kind: i.kind,
          title: i.title,
          dedupeKey: i.dedupeKey,
          orderId: i.orderId,
          owner: i.owner ?? 'AM',
          status: i.status ?? 'OPEN',
          note: i.note,
          dueAt: new Date(Date.now() + ISSUE_DUE_MINUTES[i.kind] * 60_000),
        },
      })
      .catch(async () => this.prisma.amIssue.findUniqueOrThrow({ where: { dedupeKey: i.dedupeKey } })); // lost a race: same issue
    return { ...row, fresh: true };
  }

  private async tellAm(storeId: string, code: string, vars: Record<string, string | number | undefined>, tag: string) {
    const s = await this.prisma.store.findUnique({ where: { id: storeId }, select: { name: true, accountManager: { select: { isActive: true, user: { select: { id: true, language: true } } } } } });
    if (!s?.accountManager?.isActive) return;
    await this.notifications.deliver(null, [{ userId: s.accountManager.user.id, language: s.accountManager.user.language }], {
      app: 'ADMIN',
      code,
      vars: { store: s.name, ...vars },
      url: `/am/stores/${storeId}`,
      tag,
      urgent: code !== 'AM_COMPLAINT',
      storeId,
    });
  }

  private async tellOps(storeId: string, title: string) {
    const s = await this.prisma.store.findUnique({ where: { id: storeId }, select: { name: true, cityId: true } });
    if (!s) return;
    const ops = await this.prisma.adminUser.findMany({
      where: { isActive: true, role: { in: ROLES.OPERATE_STORES }, ...(s.cityId ? { OR: [{ cityIds: { isEmpty: true } }, { cityIds: { has: s.cityId } }] } : { cityIds: { isEmpty: true } }) },
      select: { user: { select: { id: true, language: true } } },
    });
    await this.notifications.deliver(
      null,
      ops.map((o) => ({ userId: o.user.id, language: o.user.language })),
      { app: 'ADMIN', code: 'AM_ESCALATED', vars: { store: s.name, title }, url: `/stores/${storeId}`, tag: `am-esc-${storeId}`, storeId },
    );
  }

  private async onSlaBreach(e: DomainEvent) {
    const d = e.data as { orderId: string; orderNumber: string; storeId: string; kind: string; minutes: number };
    const m = SLA_KIND[d.kind];
    if (!m) return;
    const store = await this.prisma.store.findUnique({ where: { id: d.storeId }, select: { accountManagerId: true } });
    if (!store?.accountManagerId) return;
    const issue = await this.raise(d.storeId, { kind: m.kind, title: `${d.orderNumber} ${m.label} (${d.minutes} min)`, dedupeKey: `sla:${d.kind}:${d.orderId}`, orderId: d.orderId });
    if (issue.fresh) await this.tellAm(d.storeId, 'AM_SLA', { orderNumber: d.orderNumber, label: m.label, minutes: d.minutes }, `am-sla-${d.orderId}`);
  }

  private async onReturn(e: DomainEvent) {
    const d = e.data as { orderId: string; undelivered?: boolean; amount?: number };
    if (d.undelivered) return;
    const o = await this.prisma.order.findUnique({ where: { id: d.orderId }, select: { orderNumber: true, storeId: true, store: { select: { accountManagerId: true } } } });
    if (!o?.store.accountManagerId) return;
    const issue = await this.raise(o.storeId, { kind: 'COMPLAINT', title: `Items returned at the door · ${o.orderNumber}`, dedupeKey: `return:${d.orderId}`, orderId: d.orderId });
    if (issue.fresh) await this.tellAm(o.storeId, 'AM_COMPLAINT', { orderNumber: o.orderNumber }, `am-ret-${d.orderId}`);
  }

  /** Hourly: churn risk above 70 and sudden order drops become issues + alerts (once a day per store). */
  async healthCheck(now = new Date()) {
    try {
      const stores = await this.prisma.store.findMany({ where: { accountManagerId: { not: null } }, select: { id: true } });
      if (!stores.length) return { checked: 0, raised: 0 };
      const hm = await this.healthOf(
        stores.map((s) => s.id),
        now,
      );
      let raised = 0;
      const day = istDate(now);
      for (const [storeId, { health: h }] of hm) {
        if (h.risk != null && h.risk > RISK.HIGH) {
          const top = [...h.breakdown].sort((a, b) => b.points - a.points)[0];
          const i = await this.raise(storeId, {
            kind: 'CHURN_RISK',
            title: `Churn risk ${h.risk}/100`,
            dedupeKey: `churn:${storeId}:${day}`,
            note: `Biggest factor: ${top.factor.replace('_', ' ').toLowerCase()}`,
          });
          if (i.fresh) (raised++, await this.tellAm(storeId, 'AM_CHURN', { risk: h.risk }, `am-churn-${storeId}`));
        }
        if (h.orderDropPct >= 40 && h.previous.orders >= 10) {
          const i = await this.raise(storeId, { kind: 'ORDER_DROP', title: `Orders down ${h.orderDropPct}% (${h.previous.orders} → ${h.current.orders})`, dedupeKey: `drop:${storeId}:${day}` });
          if (i.fresh) (raised++, await this.tellAm(storeId, 'AM_DROP', { pct: h.orderDropPct, from: h.previous.orders, to: h.current.orders }, `am-drop-${storeId}`));
        }
      }
      return { checked: stores.length, raised };
    } catch (err) {
      this.logger.error(`AM health check failed: ${(err as Error).message}`);
      return { checked: 0, raised: 0 };
    }
  }
}
