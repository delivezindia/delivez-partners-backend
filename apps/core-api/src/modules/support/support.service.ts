import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import type { PartnerRole, Prisma, TicketStatus } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminContext } from '../admin/admin.guard';

export const PARTNER_CATEGORIES = ['ORDER_ISSUE', 'PAYOUT', 'MENU', 'ACCOUNT', 'TECH', 'OTHER'] as const;
export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];
export const CUSTOMER_CATEGORIES = ['ORDER_ISSUE', 'MISSING_ITEM', 'PAYMENT_REFUND', 'MEDICINE', 'LAB_BOOKING', 'ACCOUNT', 'OTHER'] as const;
export type CustomerCategory = (typeof CUSTOMER_CATEGORIES)[number];
const OPEN_STATES: TicketStatus[] = ['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER'];

const INCLUDE = {
  store: { select: { id: true, name: true, cityId: true, phone: true, city: { select: { name: true } } } },
  order: { select: { id: true, orderNumber: true, status: true } },
  raisedBy: { select: { id: true, fullName: true, phone: true } },
  messages: { orderBy: { createdAt: 'asc' as const }, include: { sender: { select: { fullName: true } } } },
} satisfies Prisma.SupportTicketInclude;
type TicketRow = Prisma.SupportTicketGetPayload<{ include: typeof INCLUDE }>;

/**
 * Help & support (P26): a shop raises a ticket from the app, Delivez support answers in the admin console.
 * Every message notifies the other side (push + inbox).
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  // ------------------------------------------------------------------
  // Partner side
  // ------------------------------------------------------------------

  /** Owners and managers see every ticket of the outlet; other staff see the ones they raised. */
  private partnerScope(storeId: string, viewer: { userId: string; role: PartnerRole }): Prisma.SupportTicketWhereInput {
    return { storeId, raisedByType: 'PARTNER', ...(viewer.role === 'OWNER' || viewer.role === 'MANAGER' ? {} : { raisedByUserId: viewer.userId }) };
  }

  async partnerList(storeId: string, viewer: { userId: string; role: PartnerRole }) {
    const rows = await this.prisma.supportTicket.findMany({ where: this.partnerScope(storeId, viewer), include: INCLUDE, orderBy: { lastMessageAt: 'desc' }, take: 100 });
    return { tickets: rows.map((t) => this.summary(t)) };
  }

  async partnerGet(storeId: string, id: string, viewer: { userId: string; role: PartnerRole }) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, ...this.partnerScope(storeId, viewer) }, include: INCLUDE });
    if (!t) throw new ApiError(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'Ticket not found');
    return this.view(t, false);
  }

  async create(storeId: string, input: { category: PartnerCategory; subject: string; message: string; orderNumber?: string }, viewer: { userId: string; role: PartnerRole }) {
    let orderId: string | undefined;
    if (input.orderNumber) {
      const o = await this.prisma.order.findFirst({ where: { storeId, orderNumber: input.orderNumber.trim().toUpperCase() }, select: { id: true } });
      if (!o) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'ORDER_NOT_FOUND', 'No order with that number at this outlet');
      orderId = o.id;
    }
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { name: true, cityId: true } });
    const t = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          ticketNumber: await this.newNumber(tx),
          storeId,
          orderId,
          raisedByUserId: viewer.userId,
          raisedByType: 'PARTNER',
          category: input.category,
          subject: input.subject,
          priority: input.category === 'ORDER_ISSUE' || input.category === 'PAYOUT' ? 'HIGH' : 'NORMAL',
          messages: { create: { senderUserId: viewer.userId, body: input.message } },
        },
      });
      await this.events.publish(tx, { type: 'support.ticket_created', data: { storeId, ticketId: ticket.id, ticketNumber: ticket.ticketNumber, subject: input.subject, storeName: store.name, cityId: store.cityId }, actor: { type: 'PARTNER', userId: viewer.userId, role: viewer.role } });
      return ticket;
    });
    return this.partnerGet(storeId, t.id, viewer);
  }

  async partnerReply(storeId: string, id: string, body: string, viewer: { userId: string; role: PartnerRole }) {
    const t = await this.partnerGet(storeId, id, viewer);
    if (t.status === 'CLOSED') throw new ApiError(HttpStatus.CONFLICT, 'TICKET_CLOSED', 'This ticket is closed — raise a new one');
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { ticketId: id, senderUserId: viewer.userId, body } });
      // A reply re-opens a ticket that support marked solved or was waiting on the shop.
      await tx.supportTicket.update({ where: { id }, data: { lastMessageAt: new Date(), ...(t.status === 'RESOLVED' || t.status === 'WAITING_ON_USER' ? { status: 'OPEN', resolvedAt: null } : {}) } });
      const row = await tx.supportTicket.findUniqueOrThrow({ where: { id }, select: { assignedAdminId: true, store: { select: { cityId: true, name: true } } } });
      await this.events.publish(tx, { type: 'support.partner_replied', data: { storeId, ticketId: id, ticketNumber: t.number, subject: t.subject, storeName: row.store?.name, cityId: row.store?.cityId, assignedAdminId: row.assignedAdminId }, actor: { type: 'PARTNER', userId: viewer.userId, role: viewer.role } });
    });
    return this.partnerGet(storeId, id, viewer);
  }

  /** The shop says it's sorted. */
  async partnerResolve(storeId: string, id: string, viewer: { userId: string; role: PartnerRole }) {
    const t = await this.partnerGet(storeId, id, viewer);
    if (!OPEN_STATES.includes(t.status as TicketStatus)) return t;
    await this.prisma.supportTicket.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    return this.partnerGet(storeId, id, viewer);
  }

  // ------------------------------------------------------------------
  // Customer side (Local app) — a customer sees only their own tickets
  // ------------------------------------------------------------------

  async customerList(userId: string) {
    const rows = await this.prisma.supportTicket.findMany({ where: { raisedByUserId: userId, raisedByType: 'CUSTOMER' }, include: INCLUDE, orderBy: { lastMessageAt: 'desc' }, take: 100 });
    return { tickets: rows.map((t) => ({ ...this.summary(t), store: t.store ? { name: t.store.name } : null })) };
  }

  async customerGet(userId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, raisedByUserId: userId, raisedByType: 'CUSTOMER' }, include: INCLUDE });
    if (!t) throw new ApiError(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'Ticket not found');
    return { ...this.view(t, false), store: t.store ? { name: t.store.name } : null };
  }

  async customerCreate(userId: string, input: { category: CustomerCategory; subject: string; message: string; orderId?: string }) {
    let order: { id: string; storeId: string; orderNumber: string } | null = null;
    if (input.orderId) {
      order = await this.prisma.order.findFirst({ where: { id: input.orderId, customer: { userId } }, select: { id: true, storeId: true, orderNumber: true } });
      if (!order) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    }
    const store = order ? await this.prisma.store.findUniqueOrThrow({ where: { id: order.storeId }, select: { name: true, cityId: true } }) : null;
    const t = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          ticketNumber: await this.newNumber(tx),
          storeId: order?.storeId,
          orderId: order?.id,
          raisedByUserId: userId,
          raisedByType: 'CUSTOMER',
          category: input.category,
          subject: input.subject,
          // A problem with an order in progress or money is answered first.
          priority: input.category === 'ACCOUNT' || input.category === 'OTHER' ? 'NORMAL' : 'HIGH',
          messages: { create: { senderUserId: userId, body: input.message } },
        },
      });
      await this.events.publish(tx, { type: 'support.ticket_created', data: { storeId: order?.storeId, ticketId: ticket.id, ticketNumber: ticket.ticketNumber, subject: input.subject, storeName: store ? `Customer · ${store.name}` : 'Customer', cityId: store?.cityId ?? null }, actor: { type: 'CUSTOMER', userId } });
      return ticket;
    });
    return this.customerGet(userId, t.id);
  }

  async customerReply(userId: string, id: string, body: string) {
    const t = await this.customerGet(userId, id);
    if (t.status === 'CLOSED') throw new ApiError(HttpStatus.CONFLICT, 'TICKET_CLOSED', 'This ticket is closed — raise a new one');
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { ticketId: id, senderUserId: userId, body } });
      await tx.supportTicket.update({ where: { id }, data: { lastMessageAt: new Date(), ...(t.status === 'RESOLVED' || t.status === 'WAITING_ON_USER' ? { status: 'OPEN', resolvedAt: null } : {}) } });
      const row = await tx.supportTicket.findUniqueOrThrow({ where: { id }, select: { assignedAdminId: true, storeId: true, store: { select: { cityId: true, name: true } } } });
      await this.events.publish(tx, { type: 'support.partner_replied', data: { storeId: row.storeId, ticketId: id, ticketNumber: t.number, subject: t.subject, storeName: row.store ? `Customer · ${row.store.name}` : 'Customer', cityId: row.store?.cityId, assignedAdminId: row.assignedAdminId }, actor: { type: 'CUSTOMER', userId } });
    });
    return this.customerGet(userId, id);
  }

  async customerResolve(userId: string, id: string) {
    const t = await this.customerGet(userId, id);
    if (!OPEN_STATES.includes(t.status as TicketStatus)) return t;
    await this.prisma.supportTicket.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    return this.customerGet(userId, id);
  }

  // ------------------------------------------------------------------
  // Admin side (city-scoped)
  // ------------------------------------------------------------------

  private adminScope(admin: AdminContext): Prisma.SupportTicketWhereInput {
    return admin.cityIds.length ? { store: { cityId: { in: admin.cityIds } } } : {};
  }

  async adminList(admin: AdminContext, q: { status?: string; q?: string }) {
    const status: Prisma.SupportTicketWhereInput =
      q.status === 'ACTIVE' || !q.status ? { status: { in: OPEN_STATES } } : q.status === 'ALL' ? {} : { status: q.status as TicketStatus };
    const search = q.q?.trim();
    const rows = await this.prisma.supportTicket.findMany({
      where: {
        ...this.adminScope(admin),
        ...status,
        ...(search ? { OR: [{ ticketNumber: { contains: search, mode: 'insensitive' } }, { subject: { contains: search, mode: 'insensitive' } }, { store: { name: { contains: search, mode: 'insensitive' } } }] } : {}),
      },
      include: INCLUDE,
      orderBy: [{ lastMessageAt: 'desc' }],
      take: 200,
    });
    const counts = await this.prisma.supportTicket.groupBy({ by: ['status'], where: this.adminScope(admin), _count: { _all: true } });
    const admins = await this.adminNames(rows.map((r) => r.assignedAdminId));
    return {
      tickets: rows.map((t) => ({ ...this.summary(t), store: t.store ? { id: t.store.id, name: t.store.name, city: t.store.city?.name ?? null } : null, assignedTo: t.assignedAdminId ? admins.get(t.assignedAdminId) ?? null : null })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    };
  }

  async adminGet(admin: AdminContext, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, ...this.adminScope(admin) }, include: INCLUDE });
    if (!t) throw new ApiError(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'Ticket not found');
    const admins = await this.adminNames([t.assignedAdminId]);
    return { ...this.view(t, true), store: t.store ? { id: t.store.id, name: t.store.name, city: t.store.city?.name ?? null, phone: t.store.phone } : null, raisedBy: { name: t.raisedBy.fullName, phone: t.raisedBy.phone }, assignedTo: t.assignedAdminId ? admins.get(t.assignedAdminId) ?? null : null, mine: t.assignedAdminId === admin.adminId };
  }

  async adminReply(admin: AdminContext, id: string, body: string, status: 'WAITING_ON_USER' | 'RESOLVED' | 'IN_PROGRESS' = 'WAITING_ON_USER') {
    const t = await this.adminGet(admin, id);
    if (t.status === 'CLOSED') throw new ApiError(HttpStatus.CONFLICT, 'TICKET_CLOSED', 'This ticket is closed');
    await this.prisma.$transaction(async (tx) => {
      await tx.ticketMessage.create({ data: { ticketId: id, senderUserId: admin.userId, body, fromAdmin: true } });
      await tx.supportTicket.update({ where: { id }, data: { lastMessageAt: new Date(), status, resolvedAt: status === 'RESOLVED' ? new Date() : null, assignedAdminId: t.assignedTo ? undefined : admin.adminId } });
      await this.events.publish(tx, { type: 'support.admin_replied', data: { storeId: t.store?.id, ticketId: id, ticketNumber: t.number, subject: t.subject, status, raisedByUserId: t.raisedByUserId }, actor: { type: 'ADMIN', userId: admin.userId, role: admin.role } });
    });
    return this.adminGet(admin, id);
  }

  async adminStatus(admin: AdminContext, id: string, status: TicketStatus) {
    const t = await this.adminGet(admin, id);
    await this.prisma.$transaction(async (tx) => {
      await tx.supportTicket.update({ where: { id }, data: { status, resolvedAt: status === 'RESOLVED' || status === 'CLOSED' ? new Date() : null } });
      if (status === 'RESOLVED') await this.events.publish(tx, { type: 'support.resolved', data: { storeId: t.store?.id, ticketId: id, ticketNumber: t.number, subject: t.subject, raisedByUserId: t.raisedByUserId }, actor: { type: 'ADMIN', userId: admin.userId, role: admin.role } });
    });
    return this.adminGet(admin, id);
  }

  async adminAssign(admin: AdminContext, id: string) {
    await this.adminGet(admin, id);
    await this.prisma.supportTicket.update({ where: { id }, data: { assignedAdminId: admin.adminId, status: 'IN_PROGRESS' } });
    return this.adminGet(admin, id);
  }

  // ------------------------------------------------------------------

  private summary(t: TicketRow) {
    const last = t.messages[t.messages.length - 1];
    return {
      id: t.id,
      number: t.ticketNumber,
      category: t.category,
      raisedByType: t.raisedByType,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      order: t.order ? { id: t.order.id, orderNumber: t.order.orderNumber } : null,
      createdAt: t.createdAt,
      lastMessageAt: t.lastMessageAt,
      lastFromAdmin: !!last?.fromAdmin,
      messages: t.messages.length,
    };
  }

  private view(t: TicketRow, forAdmin: boolean) {
    return {
      ...this.summary(t),
      raisedByUserId: t.raisedByUserId,
      resolvedAt: t.resolvedAt,
      // Shops see "Delivez support", not which admin wrote.
      thread: t.messages.map((m) => ({ id: m.id, body: m.body, fromAdmin: m.fromAdmin, author: m.fromAdmin ? (forAdmin ? m.sender.fullName ?? 'Delivez support' : 'Delivez support') : m.sender.fullName ?? (t.raisedByType === 'CUSTOMER' ? (forAdmin ? 'Customer' : 'You') : 'Shop'), at: m.createdAt })),
    };
  }

  private async adminNames(ids: (string | null)[]) {
    const list = [...new Set(ids.filter((x): x is string => !!x))];
    const rows = list.length ? await this.prisma.adminUser.findMany({ where: { id: { in: list } }, select: { id: true, user: { select: { fullName: true } } } }) : [];
    return new Map(rows.map((r) => [r.id, r.user.fullName ?? 'Admin']));
  }

  private async newNumber(tx: Prisma.TransactionClient) {
    for (let i = 0; i < 8; i++) {
      const n = `SUP-${randomInt(100000, 1000000)}`;
      if (!(await tx.supportTicket.findUnique({ where: { ticketNumber: n }, select: { id: true } }))) return n;
    }
    throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'TICKET_NUMBER_EXHAUSTED', 'Please try again');
  }
}
