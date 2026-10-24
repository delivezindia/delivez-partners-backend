import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import type { FulfilmentType, OrderChannel, OrderStatus, PaymentMode, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { haversineKm } from '../../common/geo';
import { KvService } from '../../common/kv/kv.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { pharmacistsOnDuty } from '../pharmacy/duty';
import { ACTIVE_STATES } from './order-state';
import { OrderStateService, travelMinutes, type OrderActor } from './order-state.service';

export interface ItemInput {
  productId: string;
  qty: number;
  variantId?: string;
  addonIds?: string[];
}
export interface AddressInput {
  line1: string;
  landmark?: string;
  pincode: string;
  lat: number;
  lng: number;
}
export interface CreateOrderInput {
  storeId: string;
  channel: OrderChannel;
  fulfilmentType: FulfilmentType;
  customer: { phone: string; name?: string };
  items: ItemInput[];
  paymentMode: PaymentMode;
  address?: AddressInput;
  note?: string;
  isTestOrder?: boolean;
  /** Store-created orders start accepted (prep time optional — store default if omitted). */
  startAccepted?: { prepMinutes?: number };
  /** Customer-uploaded prescription files (keys under stores/{id}/rx/) for Schedule H/H1 medicines. */
  prescriptionFileKeys?: string[];
  /** Store-created pharmacy orders: staff confirm they have seen a valid prescription. */
  rxSeenByStore?: boolean;
  /** Dev simulator only: pretend the order was placed earlier (to exercise the timeout job). */
  placedSecondsAgo?: number;
}

export type OrderTab = 'RX' | 'NEW' | 'PREPARING' | 'READY' | 'DONE' | 'CANCELLED' | 'ALL';
export const TAB_STATES: Record<Exclude<OrderTab, 'ALL'>, OrderStatus[]> = {
  RX: ['AWAITING_RX_REVIEW'],
  NEW: ['PLACED'],
  PREPARING: ['ACCEPTED', 'PREPARING', 'READY_SOON'],
  READY: ['READY'],
  DONE: ['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED', 'DELIVERED', 'COMPLETED'],
  CANCELLED: ['REJECTED', 'CANCELLED', 'DELIVERY_FAILED', 'REFUNDED'],
};

export const ACCEPT_TIMEOUT_SECONDS = 180;
/** A prescription not reviewed in this time is cancelled and refunded (the customer is waiting). */
export const RX_REVIEW_MINUTES = 15;
const DELIVERY_FEE = 3000; // paise — flat until pricing lands
const OTP_ATTEMPTS = 5;

const ORDER_INCLUDE = {
  items: true,
  customer: { include: { user: { select: { fullName: true, phone: true } } } },
  deliveryTask: { include: { rider: { include: { user: { select: { fullName: true, phone: true } } } } } },
  prescription: { include: { reviewedBy: { select: { name: true, registrationNo: true } } } },
} satisfies Prisma.OrderInclude;
type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly events: EventBus,
    private readonly kv: KvService,
    private readonly storage: StorageService,
  ) {}

  // ------------------------------------------------------------------
  // Create
  // ------------------------------------------------------------------

  async create(input: CreateOrderInput, actor: OrderActor) {
    const store = await this.prisma.store.findUnique({ where: { id: input.storeId } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    if (!['LIVE', 'LIMITED'].includes(store.status)) throw new ApiError(HttpStatus.CONFLICT, 'STORE_NOT_LIVE', 'Orders start once the store is live');
    if (store.vertical === 'DIAGNOSTICS') throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'LAB_BOOKINGS_LATER', 'Lab test bookings arrive with the bookings release');
    if (input.fulfilmentType === 'DELIVERY' && !store.supportsDelivery) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'DELIVERY_NOT_OFFERED', 'This store does not offer delivery');
    if (input.fulfilmentType === 'PICKUP' && !store.supportsPickup) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'PICKUP_NOT_OFFERED', 'This store does not offer pickup');

    let distanceKm: number | null = null;
    if (input.fulfilmentType === 'DELIVERY') {
      if (!input.address) throw new ApiError(HttpStatus.BAD_REQUEST, 'ADDRESS_REQUIRED', 'A delivery address is required');
      if (store.lat == null || store.lng == null) throw new ApiError(HttpStatus.CONFLICT, 'STORE_LOCATION_MISSING', 'Store location is not set');
      distanceKm = Math.round(haversineKm(store.lat, store.lng, input.address.lat, input.address.lng) * 10) / 10;
      const radius = store.status === 'LIMITED' ? Math.min(2, store.deliveryRadiusKm) : store.deliveryRadiusKm;
      if (distanceKm > radius) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'OUT_OF_RANGE', `The address is ${distanceKm} km away; this store delivers up to ${radius} km`);
    }

    const placedAt = new Date(Date.now() - (input.placedSecondsAgo ?? 0) * 1000);
    const manual = input.channel === 'PARTNER_MANUAL';
    let awaitingRx = false;
    const created = await this.prisma.$transaction(async (tx) => {
      const customer = await this.ensureCustomer(tx, input.customer.phone, input.customer.name);
      const priced = await this.price(tx, store.id, store.vertical, input.items);

      // Schedule H/H1 medicines: only while a registered pharmacist is on duty, and only with a prescription.
      const rxItems = store.vertical === 'PHARMACY' ? priced.filter((i) => i.isRx) : [];
      let prescriptionId: string | undefined;
      let rxMeta: Record<string, unknown> | undefined;
      if (rxItems.length) {
        const names = rxItems.map((i) => i.productName);
        const onDuty = await pharmacistsOnDuty(this.prisma, store.id);
        if (!onDuty.length) throw new ApiError(HttpStatus.CONFLICT, 'NO_PHARMACIST_ON_DUTY', 'Prescription medicines can only be ordered while a pharmacist is on duty', { items: names });
        if (manual) {
          if (!input.rxSeenByStore) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'RX_REQUIRED', 'Confirm a pharmacist has checked the customer’s prescription', { items: names });
          rxMeta = { rxSeenByStore: true, pharmacistsOnDuty: onDuty.map((p) => `${p.name} (${p.registrationNo})`) };
        } else {
          const keys = input.prescriptionFileKeys ?? [];
          if (!keys.length) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'RX_REQUIRED', 'Upload the doctor’s prescription for these medicines', { items: names });
          if (keys.some((k) => !k.startsWith(`stores/${store.id}/rx/`))) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_KEY_INVALID', 'Upload the prescription again');
          const hashes = await Promise.all(keys.map((k) => this.storage.hashOf(k)));
          if (hashes.some((h) => !h)) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_NOT_FOUND', 'Prescription upload not found');
          const rx = await tx.prescription.create({ data: { customerId: customer.id, storeId: store.id, fileUrls: keys, fileHash: hashes.join(':'), status: 'UNDER_REVIEW' } });
          prescriptionId = rx.id;
          awaitingRx = true;
        }
      }
      const itemsSubtotal = priced.reduce((s, i) => s + i.lineTotal, 0);
      const deliveryFee = input.fulfilmentType === 'DELIVERY' ? DELIVERY_FEE : 0;
      const packagingFee = store.vertical === 'EAT' ? store.packagingFee : 0;
      const grandTotal = itemsSubtotal + deliveryFee + packagingFee;
      const paid = input.paymentMode !== 'COD';

      const order = await tx.order.create({
        data: {
          orderNumber: await this.newOrderNumber(tx),
          customerId: customer.id,
          storeId: store.id,
          vertical: store.vertical,
          channel: input.channel,
          fulfilmentType: input.fulfilmentType,
          status: awaitingRx ? 'AWAITING_RX_REVIEW' : 'PLACED',
          prescriptionId,
          deliveryAddress: input.address ? { ...input.address, contactName: input.customer.name ?? null, contactPhone: customer.phone } : undefined,
          deliveryDistanceKm: distanceKm,
          itemsSubtotal,
          deliveryFee,
          packagingFee,
          grandTotal,
          paymentMode: input.paymentMode,
          paymentStatus: paid ? 'CAPTURED' : 'COD_PENDING',
          placedAt,
          // Dev simulator backdating moves the whole order, so the prescription review timeout can be tested too.
          ...(input.placedSecondsAgo ? { createdAt: placedAt } : {}),
          promisedDeliveryAt: new Date(placedAt.getTime() + (store.defaultPrepMinutes + (input.fulfilmentType === 'DELIVERY' ? travelMinutes(distanceKm) : 0)) * 60_000),
          handoverOtp: otp(),
          deliveryOtp: input.fulfilmentType === 'DELIVERY' ? otp() : null,
          pickupOtp: input.fulfilmentType === 'PICKUP' ? otp() : null,
          customerNote: input.note,
          isTestOrder: !!input.isTestOrder,
          items: { create: priced.map(({ inventoryTracked: _t, ...i }) => i) },
          payments: {
            create: {
              provider: paid ? 'RAZORPAY' : 'COD',
              amount: grandTotal,
              method: input.paymentMode,
              status: paid ? 'CAPTURED' : 'COD_PENDING',
              capturedAt: paid ? new Date() : null,
              // Simulated until the payments module is integrated.
              rawPayload: paid ? { simulated: true } : undefined,
            },
          },
        },
      });

      // Hold stock so two orders can't sell the same last unit.
      for (const item of priced.filter((i) => i.inventoryTracked)) {
        const held = await tx.$executeRaw`UPDATE inventory SET "reservedQty" = "reservedQty" + ${item.qty}, "updatedAt" = now()
          WHERE "productId" = ${item.productId} AND "trackStock" = true AND "stockQty" - "reservedQty" >= ${item.qty}`;
        if (!held) throw new ApiError(HttpStatus.CONFLICT, 'OUT_OF_STOCK', `${item.productName} is out of stock`);
        const inv = await tx.inventory.findUniqueOrThrow({ where: { productId: item.productId }, select: { id: true } });
        await tx.inventoryMovement.create({ data: { inventoryId: inv.id, type: 'RESERVE', qtyDelta: -item.qty, orderId: order.id, note: `Order ${order.orderNumber}`, actorUserId: actor.userId } });
      }

      await tx.orderStatusEvent.create({ data: { orderId: order.id, toState: order.status, actorType: actor.kind, actorId: actor.userId, meta: { channel: input.channel, ...rxMeta } as Prisma.InputJsonValue } });
      await this.events.publish(tx, {
        type: awaitingRx ? 'order.rx_submitted' : 'order.placed',
        data: {
          storeId: store.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          itemCount: priced.reduce((s, i) => s + i.qty, 0),
          grandTotal,
          fulfilmentType: input.fulfilmentType,
          isTestOrder: !!input.isTestOrder,
          ...(awaitingRx
            ? { reviewMinutes: RX_REVIEW_MINUTES, reviewBy: new Date(order.createdAt.getTime() + RX_REVIEW_MINUTES * 60_000).toISOString() }
            : { acceptBy: new Date(placedAt.getTime() + ACCEPT_TIMEOUT_SECONDS * 1000).toISOString() }),
        },
        actor: { type: actor.kind, userId: actor.userId, role: actor.role },
        correlationId: actor.correlationId,
      });
      return order;
    });

    if (awaitingRx) {
      // Waits for the pharmacist; the store sees it as a new order once the prescription is approved.
    } else if (input.startAccepted) {
      await this.state.transition(created.id, 'ACCEPT', actor.kind === 'PARTNER' ? actor : { kind: 'SYSTEM' }, { prepMinutes: input.startAccepted.prepMinutes, meta: { storeCreated: true } });
    } else if (store.autoAcceptOrders) {
      await this.state.transition(created.id, 'ACCEPT', { kind: 'SYSTEM' }, { meta: { autoAccept: true } });
    }
    return this.detailById(created.id);
  }

  private async price(tx: Prisma.TransactionClient, storeId: string, vertical: string, items: ItemInput[]) {
    if (!items.length) throw new ApiError(HttpStatus.BAD_REQUEST, 'ITEMS_REQUIRED', 'Add at least one item');
    const products = await tx.product.findMany({
      where: { storeId, id: { in: items.map((i) => i.productId) }, deletedAt: null },
      include: { variants: true, addonGroups: { include: { addons: true } }, inventory: true },
    });
    const now = new Date();
    return items.map((it) => {
      const p = products.find((x) => x.id === it.productId);
      if (!p) throw new ApiError(HttpStatus.BAD_REQUEST, 'PRODUCT_NOT_FOUND', 'An item is not on this store’s menu');
      if (!p.isAvailable || (p.pausedUntil && p.pausedUntil > now)) throw new ApiError(HttpStatus.CONFLICT, 'ITEM_UNAVAILABLE', `${p.name} is not available right now`);
      const variant = it.variantId ? p.variants.find((v) => v.id === it.variantId) : p.variants.find((v) => v.isDefault);
      if (it.variantId && !variant) throw new ApiError(HttpStatus.BAD_REQUEST, 'VARIANT_NOT_FOUND', `Unknown size for ${p.name}`);
      const allAddons = p.addonGroups.flatMap((g) => g.addons);
      const addons = (it.addonIds ?? []).map((id) => {
        const a = allAddons.find((x) => x.id === id);
        if (!a) throw new ApiError(HttpStatus.BAD_REQUEST, 'ADDON_NOT_FOUND', `Unknown add-on for ${p.name}`);
        return a;
      });
      const unitPrice = p.price + (variant?.priceDiff ?? 0) + addons.reduce((s, a) => s + a.price, 0);
      return {
        productId: p.id,
        productName: p.name,
        variantName: variant?.name ?? null,
        addons: addons.length ? addons.map((a) => ({ name: a.name, price: a.price })) : undefined,
        unitPrice,
        qty: it.qty,
        taxRatePct: p.taxRatePct,
        lineTotal: unitPrice * it.qty,
        isRx: p.prescriptionRequired,
        inventoryTracked: !!p.inventory?.trackStock,
      };
    });
  }

  private async ensureCustomer(tx: Prisma.TransactionClient, phone: string, name?: string) {
    const user = await tx.user.upsert({ where: { phone }, update: {}, create: { phone, fullName: name ?? null } });
    if (name && !user.fullName) await tx.user.update({ where: { id: user.id }, data: { fullName: name } });
    const customer = await tx.customer.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
    return { id: customer.id, phone };
  }

  private async newOrderNumber(tx: Prisma.TransactionClient) {
    for (let i = 0; i < 8; i++) {
      const n = `DEL-${randomInt(100000, 1000000)}`;
      if (!(await tx.order.findUnique({ where: { orderNumber: n }, select: { id: true } }))) return n;
    }
    throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'ORDER_NUMBER_EXHAUSTED', 'Please try again');
  }

  // ------------------------------------------------------------------
  // Store actions that aren't plain transitions
  // ------------------------------------------------------------------

  /** Adds time to the promise; customers see the new ETA. */
  async delay(storeId: string, orderId: string, minutes: number, reason: string, actor: OrderActor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const o = await this.mustOwn(storeId, orderId, tx);
      if (!['ACCEPTED', 'PREPARING', 'READY_SOON'].includes(o.status)) {
        throw new ApiError(HttpStatus.CONFLICT, 'ORDER_INVALID_TRANSITION', 'Only orders being prepared can be delayed', { status: o.status });
      }
      const base = o.currentEtaAt ?? new Date();
      await tx.order.update({
        where: { id: orderId },
        data: { promisedPrepMinutes: (o.promisedPrepMinutes ?? 0) + minutes, currentEtaAt: new Date(base.getTime() + minutes * 60_000) },
      });
      const task = await tx.deliveryTask.findUnique({ where: { orderId } });
      if (task?.readyAtEstimate) await tx.deliveryTask.update({ where: { id: task.id }, data: { readyAtEstimate: new Date(task.readyAtEstimate.getTime() + minutes * 60_000) } });
      await this.state.note(tx, o, 'order.delayed', actor, reason, { delayMinutes: minutes });
    });
    return this.detailById(orderId);
  }

  /** Store can't supply an item: drop it from the order, release its stock, refund it if prepaid. */
  async itemUnavailable(storeId: string, orderId: string, itemId: string, switchOff: boolean, actor: OrderActor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const o = await this.mustOwn(storeId, orderId, tx);
      if (!['AWAITING_RX_REVIEW', 'PLACED', 'ACCEPTED', 'PREPARING'].includes(o.status)) {
        throw new ApiError(HttpStatus.CONFLICT, 'ORDER_INVALID_TRANSITION', 'Items can only be removed before the order is ready', { status: o.status });
      }
      const items = await tx.orderItem.findMany({ where: { orderId } });
      const item = items.find((i) => i.id === itemId);
      if (!item) throw new ApiError(HttpStatus.NOT_FOUND, 'ITEM_NOT_FOUND', 'Item not on this order');
      if (item.isOutOfStock) return;
      if (items.filter((i) => !i.isOutOfStock).length === 1) {
        throw new ApiError(HttpStatus.CONFLICT, 'LAST_ITEM', 'This is the only item left — reject the order instead');
      }
      await tx.orderItem.update({ where: { id: itemId }, data: { isOutOfStock: true } });
      await this.state.releaseItem(tx, orderId, item.productId, item.qty, actor);
      await tx.order.update({ where: { id: orderId }, data: { itemsSubtotal: { decrement: item.lineTotal }, grandTotal: { decrement: item.lineTotal } } });
      if (o.paymentStatus === 'CAPTURED') {
        const payment = await tx.payment.findFirst({ where: { orderId, status: 'CAPTURED' } });
        await tx.refund.create({ data: { orderId, paymentId: payment?.id, amount: item.lineTotal, reason: `${item.productName} unavailable`, initiatedBy: 'STORE' } });
      }
      if (switchOff) {
        await tx.product.update({ where: { id: item.productId }, data: { isAvailable: false } });
        await this.events.publish(tx, { type: 'catalog.updated', data: { storeId, productIds: [item.productId] }, actor: { type: actor.kind, userId: actor.userId } });
      }
      await this.state.note(tx, o, 'order.item_unavailable', actor, `${item.productName} unavailable`, { itemId, productId: item.productId, refund: o.paymentStatus === 'CAPTURED' ? item.lineTotal : 0, switchedOff: switchOff });
    });
    return this.detailById(orderId);
  }

  /** Rider handover: the store checks the rider's OTP (or scans the QR on the rider app). */
  async handover(storeId: string, orderId: string, proof: { otp?: string; qr?: string }, actor: OrderActor) {
    const o = await this.mustOwn(storeId, orderId);
    // Check the order type and state before the code, so a wrong-screen tap doesn't burn an attempt.
    if (o.fulfilmentType !== 'DELIVERY') throw new ApiError(HttpStatus.CONFLICT, 'WRONG_FULFILMENT', 'This is a pickup order — use the customer’s pickup code');
    if (o.status !== 'READY') throw new ApiError(HttpStatus.CONFLICT, 'ORDER_INVALID_TRANSITION', 'Mark the order ready before handing it over', { status: o.status });
    await this.guardAttempts(orderId, 'handover');
    let verifiedBy: 'OTP' | 'QR';
    if (proof.qr) {
      if (!o.handoverOtp || !safeEqual(proof.qr, handoverQr(o.id, o.handoverOtp))) throw await this.wrongCode(orderId, 'handover', 'QR_INVALID', 'This QR code is not for this order');
      verifiedBy = 'QR';
    } else {
      if (!o.handoverOtp || !safeEqual(proof.otp ?? '', o.handoverOtp)) throw await this.wrongCode(orderId, 'handover', 'OTP_INCORRECT', 'Wrong handover code — ask the rider to read it again');
      verifiedBy = 'OTP';
    }
    await this.state.transition(orderId, 'HANDOVER', actor, { verifiedBy });
    return this.detailById(orderId);
  }

  /** Self-pickup: the customer shows their pickup OTP. */
  async pickupComplete(storeId: string, orderId: string, code: string, actor: OrderActor) {
    const o = await this.mustOwn(storeId, orderId);
    if (o.fulfilmentType !== 'PICKUP') throw new ApiError(HttpStatus.CONFLICT, 'WRONG_FULFILMENT', 'This is a delivery order — hand it to the rider');
    if (o.status !== 'READY') throw new ApiError(HttpStatus.CONFLICT, 'ORDER_INVALID_TRANSITION', 'Mark the order ready first', { status: o.status });
    await this.guardAttempts(orderId, 'pickup');
    if (!o.pickupOtp || !safeEqual(code, o.pickupOtp)) throw await this.wrongCode(orderId, 'pickup', 'OTP_INCORRECT', 'Wrong pickup code — ask the customer to check their app');
    await this.state.transition(orderId, 'PICKUP_COMPLETE', actor);
    return this.detailById(orderId);
  }

  private async guardAttempts(orderId: string, kind: string) {
    const n = Number((await this.kv.get(`otp:order:${orderId}:${kind}`)) ?? 0);
    if (n >= OTP_ATTEMPTS) throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong codes. Contact Delivez support to hand over this order.');
  }

  private async wrongCode(orderId: string, kind: string, code: string, message: string) {
    const n = await this.kv.incr(`otp:order:${orderId}:${kind}`, 600);
    return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, code, message, { attemptsLeft: Math.max(0, OTP_ATTEMPTS - n) });
  }

  async mustOwn(storeId: string, orderId: string, db: Prisma.TransactionClient | PrismaService = this.prisma) {
    const o = await db.order.findUnique({ where: { id: orderId } });
    if (!o || o.storeId !== storeId) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    return o;
  }

  // ------------------------------------------------------------------
  // Store views
  // ------------------------------------------------------------------

  async list(storeId: string, tab: OrderTab, cursor?: string, limit = 50) {
    const states = tab === 'ALL' ? undefined : TAB_STATES[tab];
    // Active tabs show everything (oldest first, the order of work); history tabs page newest-first.
    const active = tab === 'RX' || tab === 'NEW' || tab === 'PREPARING' || tab === 'READY';
    const rows = await this.prisma.order.findMany({
      where: { storeId, ...(states ? { status: { in: states } } : { status: { notIn: ['DRAFT', 'AWAITING_RX_REVIEW'] } }), ...(cursor && !active ? { placedAt: { lt: new Date(cursor) } } : {}) },
      include: ORDER_INCLUDE,
      orderBy: { placedAt: active ? 'asc' : 'desc' },
      take: active ? 200 : limit + 1,
    });
    const page = active ? rows : rows.slice(0, limit);
    const grouped = await this.prisma.order.groupBy({ by: ['status'], where: { storeId, status: { in: [...ACTIVE_STATES, 'AWAITING_RX_REVIEW'] } }, _count: { _all: true } });
    const count = (s: OrderStatus[]) => grouped.filter((g) => s.includes(g.status)).reduce((n, g) => n + g._count._all, 0);
    return {
      orders: page.map((o) => this.view(o)),
      counts: { RX: count(TAB_STATES.RX), NEW: count(TAB_STATES.NEW), PREPARING: count(TAB_STATES.PREPARING), READY: count(TAB_STATES.READY) },
      nextCursor: !active && rows.length > limit ? page[page.length - 1].placedAt?.toISOString() ?? null : null,
    };
  }

  async detail(storeId: string, idOrNumber: string) {
    const where = /^DEL-\d+$/i.test(idOrNumber) ? { orderNumber: idOrNumber.toUpperCase() } : { id: idOrNumber };
    const o = await this.prisma.order.findFirst({ where: { ...where, storeId }, include: ORDER_INCLUDE });
    if (!o) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    return this.withTimeline(o);
  }

  async detailById(orderId: string) {
    const o = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: ORDER_INCLUDE });
    return this.withTimeline(o);
  }

  private async withTimeline(o: OrderRow) {
    const events = await this.prisma.orderStatusEvent.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' } });
    return {
      ...this.view(o),
      timeline: events.map((e) => ({ from: e.fromState, to: e.toState, actorType: e.actorType, reason: e.reason, meta: e.meta, at: e.createdAt })),
    };
  }

  /** What the store sees. Codes (OTPs) are never sent to the store — the rider/customer read them out. */
  view(o: OrderRow) {
    const name = o.customer.user.fullName?.trim();
    const addr = (o.deliveryAddress ?? null) as { line1?: string; landmark?: string; pincode?: string } | null;
    const task = o.deliveryTask;
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      channel: o.channel,
      fulfilmentType: o.fulfilmentType,
      isTestOrder: o.isTestOrder,
      customer: { name: name ? name.split(/\s+/)[0] : 'Customer', phone: maskPhone(o.customer.user.phone) },
      deliveryArea: addr ? [addr.landmark, addr.pincode].filter(Boolean).join(' · ') || null : null,
      distanceKm: o.deliveryDistanceKm,
      note: o.customerNote,
      items: o.items.map((i) => ({ id: i.id, name: i.productName, variant: i.variantName, addons: (i.addons ?? []) as { name: string; price: number }[], qty: i.qty, unitPrice: i.unitPrice, lineTotal: i.lineTotal, isRx: i.isRx, unavailable: i.isOutOfStock })),
      totals: { items: o.itemsSubtotal, delivery: o.deliveryFee, packaging: o.packagingFee, discount: o.discountAmount, grandTotal: o.grandTotal },
      payment: { mode: o.paymentMode, status: o.paymentStatus, collectCash: o.paymentMode === 'COD' && o.paymentStatus === 'COD_PENDING' && o.fulfilmentType === 'PICKUP' ? o.grandTotal : 0 },
      prepMinutes: o.promisedPrepMinutes,
      readySoonWindowMin: o.readySoonWindowMin,
      etaAt: o.currentEtaAt,
      acceptBy: o.status === 'PLACED' && o.placedAt ? new Date(o.placedAt.getTime() + ACCEPT_TIMEOUT_SECONDS * 1000) : null,
      times: { placedAt: o.placedAt, acceptedAt: o.acceptedAt, preparingAt: o.preparingAt, readySoonAt: o.readySoonAt, readyAt: o.readyAt, pickedUpAt: o.pickedUpAt, deliveredAt: o.deliveredAt, completedAt: o.completedAt, cancelledAt: o.cancelledAt },
      rejectReason: o.rejectReason,
      cancelReason: o.cancelReason,
      rxReviewBy: o.status === 'AWAITING_RX_REVIEW' ? new Date(o.createdAt.getTime() + RX_REVIEW_MINUTES * 60_000) : null,
      rx: o.prescription
        ? {
            id: o.prescription.id,
            status: o.prescription.status,
            files: o.prescription.fileUrls.length,
            doctorName: o.prescription.doctorName,
            doctorRegNo: o.prescription.doctorRegNo,
            issuedOn: o.prescription.issuedOn,
            patientName: o.prescription.patientName,
            reviewedBy: o.prescription.reviewedBy ? { name: o.prescription.reviewedBy.name, registrationNo: o.prescription.reviewedBy.registrationNo } : null,
            reviewedAt: o.prescription.reviewedAt,
            notes: o.prescription.reviewNotes,
            rejectionReason: o.prescription.rejectionReason,
          }
        : null,
      rider: task
        ? {
            taskStatus: task.status,
            name: task.rider?.user.fullName ?? null,
            phone: task.rider ? maskPhone(task.rider.user.phone) : null,
            assignedAt: task.assignedAt,
            arrivedAt: task.arrivedPickupAt,
            waitingSince: task.waitingStartedAt,
            readyAtEstimate: task.readyAtEstimate,
          }
        : null,
    };
  }
}

// --------------------------------------------------------------------
// Codes
// --------------------------------------------------------------------

const otp = () => String(randomInt(0, 10_000)).padStart(4, '0');

function qrSecret() {
  const s = process.env.ORDER_QR_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === 'production') throw new Error('ORDER_QR_SECRET is required in production');
  return 'delivez-dev-order-qr';
}

/** QR payload shown on the rider app: order id + HMAC of the handover OTP (plan §10). */
export const handoverQr = (orderId: string, handoverOtp: string) =>
  `DZ1.${orderId}.${createHmac('sha256', qrSecret()).update(`${orderId}:${handoverOtp}`).digest('base64url').slice(0, 22)}`;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a.trim());
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export const maskPhone = (p: string) => (p.length >= 10 ? `${p.slice(-10, -5)} •••${p.slice(-2)}` : p);
