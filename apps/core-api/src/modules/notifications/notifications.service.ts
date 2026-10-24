import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { AdminRole, AppId, PartnerRole, Prisma } from '@delivez/db';
import { EventBus, type DomainEvent } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ROLES } from '../admin/admin.guard';
import { MessagingService, type MessageChannel } from '../messaging/messaging.service';
import { PushSender, type PushMessage } from './push-sender';
import { render } from './templates';

const ORDER_ROLES: PartnerRole[] = ['OWNER', 'MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST'];
const LEADS: PartnerRole[] = ['OWNER', 'MANAGER'];
const LAB_DESK: PartnerRole[] = ['OWNER', 'MANAGER', 'COUNTER_STAFF'];
/** Document uploads during onboarding are reviewed from the application; only re-uploads on running stores ping admins. */
const RUNNING = ['LIVE', 'LIMITED', 'PAUSED', 'SUSPENDED'];
/** An order nobody has accepted after this long gets a second, louder alert to the people in charge. */
export const ORDER_REMINDER_SECONDS = 60;
const ACCEPT_WINDOW_SECONDS = 180;
const REMIND_TO: PartnerRole[] = ['OWNER', 'MANAGER', 'PHARMACIST'];
const SUPPORT_ADMINS: AdminRole[] = ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD', 'CITY_OPS', 'SUPPORT'];

type Recipient = { userId: string; language: string; phone?: string; role?: PartnerRole };
interface Outgoing {
  app: AppId;
  code: string;
  vars: Record<string, string | number | undefined>;
  url: string;
  tag: string;
  urgent?: boolean;
  storeId?: string;
  extra?: Record<string, string>;
  /** Also send by SMS / WhatsApp — only to these partner roles (owners by default), with a link into the app. */
  offApp?: { channels: MessageChannel[]; roles?: PartnerRole[] };
}

const OWNER_SMS: Outgoing['offApp'] = { channels: ['SMS'], roles: ['OWNER'] };
const OWNER_WA: Outgoing['offApp'] = { channels: ['WHATSAPP'], roles: ['OWNER'] };
const OWNER_BOTH: Outgoing['offApp'] = { channels: ['SMS', 'WHATSAPP'], roles: ['OWNER'] };
const APP_URL = () => process.env.PARTNERS_WEB_URL ?? 'http://localhost:5173';

/**
 * Step 12 — turns domain events into notifications: an inbox row per person (IN_APP),
 * a push to each of their devices, and a live `notification.created` ping to their open apps.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private unsubscribe?: () => void;
  private timer?: NodeJS.Timeout;
  private reminding = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly push: PushSender,
    private readonly messaging: MessagingService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.events.subscribe('*', async (e) => void (await this.handle(e)));
    if (process.env.DISABLE_SCHEDULERS !== 'true') this.timer = setInterval(() => void this.remindUnaccepted(), 10_000);
  }

  onModuleDestroy() {
    this.unsubscribe?.();
    clearInterval(this.timer);
  }

  /** Customer orders still waiting after 60 s: one reminder to owners/managers (same tag, so it rings again). */
  async remindUnaccepted(now = new Date()) {
    if (this.reminding) return;
    this.reminding = true;
    try {
      const waiting = await this.prisma.order.findMany({
        where: {
          status: 'PLACED',
          channel: { not: 'PARTNER_MANUAL' },
          placedAt: { lt: new Date(now.getTime() - ORDER_REMINDER_SECONDS * 1000), gt: new Date(now.getTime() - ACCEPT_WINDOW_SECONDS * 1000) },
        },
        select: { id: true, storeId: true, orderNumber: true, placedAt: true },
        take: 100,
      });
      for (const o of waiting) {
        const sent = await this.prisma.notification.findFirst({ where: { templateCode: 'ORDER_REMINDER', data: { path: ['orderId'], equals: o.id } }, select: { id: true } });
        if (sent) continue;
        const left = Math.max(0, Math.round((o.placedAt!.getTime() + ACCEPT_WINDOW_SECONDS * 1000 - now.getTime()) / 1000));
        await this.toStore(null, o.storeId, REMIND_TO, {
          app: 'PARTNERS',
          code: 'ORDER_REMINDER',
          vars: { orderNumber: o.orderNumber, minutes: Math.max(1, Math.round(left / 60)) },
          url: `/stores/${o.storeId}/orders`,
          tag: `order-${o.id}`,
          urgent: true,
          extra: { orderId: o.id },
          offApp: OWNER_SMS,
        });
      }
    } catch (e) {
      this.logger.error(`Order reminders failed: ${(e as Error).message}`);
    } finally {
      this.reminding = false;
    }
  }

  // ------------------------------------------------------------------
  // Event → who + what
  // ------------------------------------------------------------------

  async handle(e: DomainEvent) {
    const d = e.data as Record<string, any>;
    const byPartner = e.actor?.type === 'PARTNER';
    const storeId: string | undefined = d.storeId;
    const orders = (no?: string) => `/stores/${storeId}/orders${no ? `/${no}` : ''}`;

    switch (e.type) {
      case 'order.placed':
        if (byPartner) return; // the store typed it in itself
        return this.toStore(e, storeId!, ORDER_ROLES, { app: 'PARTNERS', code: 'ORDER_PLACED', vars: { orderNumber: d.orderNumber, items: d.itemCount, total: d.grandTotal }, url: orders(), tag: `order-${d.orderId}`, urgent: true });
      case 'order.rx_submitted':
        return this.toStore(e, storeId!, REMIND_TO, { app: 'PARTNERS', code: 'RX_REVIEW', vars: { orderNumber: d.orderNumber, items: d.itemCount, total: d.grandTotal, minutes: d.reviewMinutes }, url: `/stores/${storeId}/prescriptions`, tag: `order-${d.orderId}`, urgent: true });
      case 'order.rx_approved':
        // Approved by the pharmacist: now it is a new order for the counter/kitchen to accept.
        return this.toStore(e, storeId!, ORDER_ROLES, { app: 'PARTNERS', code: 'ORDER_PLACED', vars: { orderNumber: d.orderNumber, items: d.itemCount, total: d.grandTotal }, url: orders(), tag: `order-${d.orderId}`, urgent: true });
      case 'order.rejected':
        if (e.actor?.type !== 'SYSTEM') return; // only timeouts are news to the store
        return this.toStore(e, storeId!, LEADS, { app: 'PARTNERS', code: 'ORDER_MISSED', vars: { orderNumber: d.orderNumber }, url: orders(d.orderNumber), tag: `order-${d.orderId}`, offApp: OWNER_SMS });
      case 'order.cancelled':
        if (byPartner) return;
        return this.toStore(e, storeId!, ORDER_ROLES, { app: 'PARTNERS', code: 'ORDER_CANCELLED', vars: { orderNumber: d.orderNumber, reason: d.reason }, url: orders(d.orderNumber), tag: `order-${d.orderId}`, urgent: true });
      case 'delivery.task_updated': {
        if (d.status !== 'ARRIVED_AT_PICKUP') return;
        const o = await this.prisma.order.findUnique({ where: { id: d.orderId }, select: { orderNumber: true, status: true } });
        if (!o) return;
        return this.toStore(e, storeId!, ORDER_ROLES, { app: 'PARTNERS', code: 'RIDER_ARRIVED', vars: { orderNumber: o.orderNumber, ready: o.status === 'READY' ? 1 : 0 }, url: orders(o.orderNumber), tag: `order-${d.orderId}`, urgent: true });
      }
      case 'inventory.low_stock': {
        // One per product per 12 h — every sale below the threshold re-fires the event.
        const recent = await this.prisma.notification.findFirst({
          where: { templateCode: 'LOW_STOCK', createdAt: { gte: new Date(Date.now() - 12 * 3600_000) }, AND: [{ data: { path: ['productId'], equals: d.productId } }, { data: { path: ['storeId'], equals: storeId } }] },
          select: { id: true },
        });
        if (recent) return;
        return this.toStore(e, storeId!, ['OWNER', 'MANAGER', 'PHARMACIST'], { app: 'PARTNERS', code: 'LOW_STOCK', vars: { name: d.name, available: d.available }, url: `/stores/${storeId}/inventory`, tag: `stock-${d.productId}`, extra: { productId: d.productId } });
      }
      case 'lab.booking_created':
        if (byPartner) return;
        return this.toStore(e, storeId!, LAB_DESK, { app: 'PARTNERS', code: 'LAB_BOOKING', vars: { bookingNumber: d.bookingNumber, type: d.collectionType, rx: d.rxRequired ? 1 : 0, when: slot(d.slotStart) }, url: `/stores/${storeId}/bookings`, tag: `lab-${d.bookingId}`, urgent: true });
      case 'lab.booking_cancelled':
        if (byPartner) return;
        return this.toStore(e, storeId!, LAB_DESK, { app: 'PARTNERS', code: 'LAB_CANCELLED', vars: { bookingNumber: d.bookingNumber }, url: `/stores/${storeId}/bookings`, tag: `lab-${d.bookingId}` });
      case 'document.verified':
      case 'document.rejected': {
        if (!storeId) return;
        const store = await this.storeName(storeId);
        return this.toStore(e, storeId, LEADS, { app: 'PARTNERS', code: e.type === 'document.verified' ? 'DOC_VERIFIED' : 'DOC_REJECTED', vars: { label: d.label, reason: d.reason, store }, url: `/stores/${storeId}/settings?tab=documents`, tag: `doc-${d.documentId}`, offApp: e.type === 'document.rejected' ? OWNER_WA : undefined });
      }
      case 'store.status_changed':
        return this.toStore(e, storeId!, LEADS, { app: 'PARTNERS', code: 'STORE_STATUS', vars: { store: await this.storeName(storeId!), to: d.to, reason: d.reason }, url: `/stores/${storeId}`, tag: `store-${storeId}`, offApp: OWNER_BOTH });
      case 'store.admin_notice':
        return this.toStore(e, storeId!, null, { app: 'PARTNERS', code: 'ADMIN_NOTICE', vars: { store: await this.storeName(storeId!), message: d.message }, url: `/stores/${storeId}`, tag: `notice-${d.noticeId}`, offApp: OWNER_WA });
      case 'staff.invited': {
        const m = await this.prisma.partnerMember.findUnique({ where: { id: d.memberId }, select: { role: true, user: { select: { id: true, language: true, phone: true } } } });
        if (!m) return;
        // They may not have the app yet, so the invite goes by SMS + WhatsApp with the login link.
        return this.deliver(e, [{ userId: m.user.id, language: m.user.language, phone: m.user.phone, role: m.role }], { app: 'PARTNERS', code: 'STAFF_ADDED', vars: { store: await this.storeName(storeId!), role: d.role }, url: '/login?next=/accounts', tag: `invite-${d.memberId}`, storeId, offApp: { channels: ['SMS', 'WHATSAPP'] } });
      }
      case 'bank.verification_updated':
        if (d.status !== 'VERIFIED' && d.status !== 'FAILED') return;
        return this.toStore(e, storeId!, ['OWNER'], { app: 'PARTNERS', code: 'BANK_STATUS', vars: { ok: d.status === 'VERIFIED' ? 1 : 0, store: await this.storeName(storeId!) }, url: `/stores/${storeId}/settings?tab=bank`, tag: `bank-${storeId}` });

      case 'inventory.expiry_digest':
        return this.toStore(e, storeId!, ['OWNER', 'MANAGER', 'PHARMACIST'], { app: 'PARTNERS', code: 'EXPIRY_ALERT', vars: { expired: d.expired, expiring: d.expiring, days: d.days }, url: `/stores/${storeId}/inventory?filter=EXPIRING`, tag: `expiry-${storeId}`, extra: { date: d.date } });
      case 'store.daily_summary':
        return this.toStore(e, storeId!, ['OWNER'], { app: 'PARTNERS', code: 'DAILY_SUMMARY', vars: { store: await this.storeName(storeId!), orders: d.orders, sales: d.revenue, missed: d.missed }, url: `/stores/${storeId}`, tag: `daily-${storeId}`, extra: { date: d.date } });
      case 'support.admin_replied':
      case 'support.resolved': {
        const u = await this.prisma.user.findUnique({ where: { id: d.raisedByUserId }, select: { id: true, language: true } });
        if (!u) return;
        const resolved = e.type === 'support.resolved' || d.status === 'RESOLVED';
        return this.deliver(e, [{ userId: u.id, language: u.language }], { app: 'PARTNERS', code: resolved ? 'SUPPORT_RESOLVED' : 'SUPPORT_REPLY', vars: { ticket: d.ticketNumber, subject: d.subject }, url: `/stores/${storeId}/help?ticket=${d.ticketId}`, tag: `ticket-${d.ticketId}`, storeId });
      }

      // ---- Admin console
      case 'support.ticket_created':
        return this.deliver(e, await this.admins(SUPPORT_ADMINS, d.cityId ?? null), { app: 'ADMIN', code: 'ADMIN_SUPPORT', vars: { store: d.storeName, ticket: d.ticketNumber, subject: d.subject }, url: `/support?ticket=${d.ticketId}`, tag: `ticket-${d.ticketId}`, storeId });
      case 'support.partner_replied': {
        // The admin handling it, or the city's support people when nobody has picked it up.
        const owner = d.assignedAdminId ? await this.prisma.adminUser.findFirst({ where: { id: d.assignedAdminId, isActive: true }, select: { user: { select: { id: true, language: true } } } }) : null;
        const to = owner ? [{ userId: owner.user.id, language: owner.user.language }] : await this.admins(SUPPORT_ADMINS, d.cityId ?? null);
        return this.deliver(e, to, { app: 'ADMIN', code: 'ADMIN_SUPPORT_REPLY', vars: { store: d.storeName, ticket: d.ticketNumber, subject: d.subject }, url: `/support?ticket=${d.ticketId}`, tag: `ticket-${d.ticketId}`, storeId });
      }
      case 'onboarding.submitted': {
        const s = await this.prisma.store.findUnique({ where: { id: storeId }, select: { name: true, cityId: true, city: { select: { name: true } } } });
        if (!s) return;
        return this.deliver(e, await this.admins(ROLES.APPROVE_STORES, s.cityId), { app: 'ADMIN', code: 'ADMIN_REVIEW', vars: { store: s.name, score: d.readinessScore, city: s.city?.name }, url: `/stores/${storeId}`, tag: `review-${storeId}`, storeId });
      }
      case 'document.uploaded': {
        if (!storeId || !RUNNING.includes(d.storeStatus)) return;
        const s = await this.prisma.store.findUnique({ where: { id: storeId }, select: { name: true, cityId: true } });
        if (!s) return;
        return this.deliver(e, await this.admins(ROLES.VERIFY_DOCUMENTS, s.cityId), { app: 'ADMIN', code: 'ADMIN_DOC', vars: { store: s.name, label: String(d.type).replace(/_/g, ' ').toLowerCase() }, url: '/documents', tag: `doc-${d.documentId}`, storeId });
      }
    }
  }

  /** Active members who can see this store; `roles = null` means everyone. */
  private async toStore(e: DomainEvent | null, storeId: string, roles: PartnerRole[] | null, out: Omit<Outgoing, 'storeId'>) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { partnerAccountId: true } });
    if (!store) return;
    const members = await this.prisma.partnerMember.findMany({
      where: { partnerAccountId: store.partnerAccountId, isActive: true, ...(roles ? { role: { in: roles } } : {}), OR: [{ storeIds: { isEmpty: true } }, { storeIds: { has: storeId } }] },
      select: { role: true, user: { select: { id: true, language: true, phone: true } } },
    });
    return this.deliver(e, members.map((m) => ({ userId: m.user.id, language: m.user.language, phone: m.user.phone, role: m.role })), { ...out, storeId });
  }

  private async admins(roles: AdminRole[], cityId: string | null) {
    const rows = await this.prisma.adminUser.findMany({
      where: { isActive: true, role: { in: roles }, ...(cityId ? { OR: [{ cityIds: { isEmpty: true } }, { cityIds: { has: cityId } }] } : { cityIds: { isEmpty: true } }) },
      select: { user: { select: { id: true, language: true } } },
    });
    return rows.map((r) => ({ userId: r.user.id, language: r.user.language }));
  }

  private async storeName(storeId: string) {
    return (await this.prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }))?.name ?? 'your store';
  }

  // ------------------------------------------------------------------
  // Delivery
  // ------------------------------------------------------------------

  /** Inbox row + push + live ping per recipient. Safe to call twice for the same event (outbox is at-least-once). */
  async deliver(e: DomainEvent | null, to: Recipient[], out: Outgoing) {
    const people = [...new Map(to.map((r) => [r.userId, r])).values()];
    if (!people.length) return [];
    if (e) {
      const seen = await this.prisma.notification.findFirst({ where: { data: { path: ['eventId'], equals: e.id } }, select: { id: true } });
      if (seen) return [];
    }
    return Promise.all(people.map((p) => this.deliverOne(e, p, out)));
  }

  private async deliverOne(e: DomainEvent | null, p: Recipient, out: Outgoing) {
    const { title, body } = render(out.code, p.language, out.vars);
    const data = { eventId: e?.id ?? null, storeId: out.storeId ?? null, url: out.url, tag: out.tag, ...out.extra } as Prisma.InputJsonValue;
    const row = await this.prisma.$transaction(async (tx) => {
      const n = await tx.notification.create({ data: { userId: p.userId, app: out.app, channel: 'IN_APP', templateCode: out.code, title, body, data } });
      await this.events.publish(tx, { type: 'notification.created', data: { userId: p.userId, notificationId: n.id, app: out.app } });
      return n;
    });

    if (out.offApp && p.phone && (!out.offApp.roles || (p.role && out.offApp.roles.includes(p.role)))) {
      const text = `Delivez: ${title}. ${body} ${APP_URL()}${out.url}`;
      for (const channel of out.offApp.channels) {
        // Emoji turn an SMS into costlier Unicode and DLT templates reject them; WhatsApp keeps them.
        const msg = channel === 'SMS' ? text.replace(/\p{Extended_Pictographic}️?\s?/gu, '') : text;
        await this.messaging.send({ channel, to: p.phone, userId: p.userId, template: out.code, body: msg, vars: { ...Object.fromEntries(Object.entries(out.vars).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])), link: `${APP_URL()}${out.url}` } }).catch((err) => this.logger.warn(`${channel} to ${p.userId} failed: ${err.message}`));
      }
    }

    const devices = await this.prisma.deviceToken.findMany({ where: { userId: p.userId, app: out.app, isActive: true } });
    const message: PushMessage = { title, body, url: out.url, tag: out.tag, urgent: out.urgent, data: { notificationId: row.id, code: out.code } };
    const results = await Promise.all(devices.map((dv) => this.push.send(dv.token, dv.platform, message).then((r) => ({ id: dv.id, r }))));
    const dead = results.filter((x) => x.r === 'INVALID_TOKEN').map((x) => x.id);
    if (dead.length) await this.prisma.deviceToken.updateMany({ where: { id: { in: dead } }, data: { isActive: false } });
    const sent = results.filter((x) => x.r === 'SENT' || x.r === 'LOGGED').length;
    if (devices.length) {
      await this.prisma.notification.update({ where: { id: row.id }, data: sent ? { status: 'SENT', sentAt: new Date() } : { status: 'FAILED' } });
    }
    return { notificationId: row.id, userId: p.userId, devices: devices.length, sent, removed: dead.length };
  }

  // ------------------------------------------------------------------
  // Inbox + devices (called by the controller)
  // ------------------------------------------------------------------

  async list(userId: string, app: AppId, before?: string, limit = 30) {
    const rows = await this.prisma.notification.findMany({
      where: { userId, app, channel: 'IN_APP', ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map((n) => {
        const d = (n.data ?? {}) as { url?: string; storeId?: string | null };
        return { id: n.id, code: n.templateCode, title: n.title, body: n.body, url: d.url ?? null, storeId: d.storeId ?? null, readAt: n.readAt, createdAt: n.createdAt };
      }),
      unread: await this.unread(userId, app),
      nextBefore: rows.length > limit ? page[page.length - 1].createdAt.toISOString() : null,
    };
  }

  unread(userId: string, app: AppId) {
    return this.prisma.notification.count({ where: { userId, app, channel: 'IN_APP', readAt: null } });
  }

  async markRead(userId: string, app: AppId, id?: string) {
    await this.prisma.notification.updateMany({ where: { userId, app, readAt: null, ...(id ? { id } : {}) }, data: { readAt: new Date(), status: 'READ' } });
    return { unread: await this.unread(userId, app) };
  }

  async registerDevice(userId: string, app: AppId, token: string, platform: 'WEB' | 'ANDROID' | 'IOS') {
    // A token belongs to one browser/phone; if someone else logs in there, it moves to them.
    await this.prisma.deviceToken.upsert({ where: { token }, update: { userId, app, platform, isActive: true }, create: { userId, app, platform, token } });
    return { ok: true, devices: await this.prisma.deviceToken.count({ where: { userId, app, isActive: true } }) };
  }

  async removeDevice(userId: string, token: string) {
    await this.prisma.deviceToken.updateMany({ where: { userId, token }, data: { isActive: false } });
    return { ok: true };
  }

  async test(userId: string, app: AppId) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { language: true } });
    const [r] = await this.deliver(null, [{ userId, language: u.language }], { app, code: 'TEST', vars: {}, url: app === 'ADMIN' ? '/' : '/accounts', tag: 'test' });
    return { ...r, pushEnabled: this.push.enabled };
  }
}

const slot = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '';
