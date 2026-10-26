import { HttpStatus, Injectable } from '@nestjs/common';
import type { FulfilmentType, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { haversineKm } from '../../common/geo';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStateService } from '../orders/order-state.service';
import { DELIVERY_FEE, OrdersService, type ItemInput } from '../orders/orders.service';
import { LocalAccountService } from './local-account.service';

export interface CheckoutInput {
  storeId: string;
  fulfilmentType: FulfilmentType;
  addressId?: string;
  items: ItemInput[];
  paymentMode: 'COD';
  note?: string;
}

/** A basket line the customer has to fix before ordering. */
type Problem = { productId: string; code: 'GONE' | 'UNAVAILABLE' | 'OUT_OF_STOCK' | 'FEW_LEFT' | 'OPTIONS_CHANGED'; name: string; left?: number };

const ORDER_INCLUDE = {
  items: true,
  store: { select: { id: true, name: true, slug: true, phone: true, addressLine1: true, lat: true, lng: true, vertical: true } },
  deliveryTask: { include: { rider: { include: { user: { select: { fullName: true, phone: true } } } } } },
} satisfies Prisma.OrderInclude;
type Row = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

const LIMITED_RADIUS_KM = 2;

/**
 * Customer orders (Local app, L2): price the basket on the server, then place it through the same
 * OrdersService.create path as every other channel (stock holds, prescriptions, events, auto-accept).
 */
@Injectable()
export class LocalOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    private readonly state: OrderStateService,
    private readonly account: LocalAccountService,
  ) {}

  /** Bill preview for the cart screen: real prices, fees, and anything that stops the order. */
  async quote(userId: string, input: Omit<CheckoutInput, 'paymentMode' | 'note'>) {
    const store = await this.prisma.store.findFirst({ where: { id: input.storeId, status: { in: ['LIVE', 'LIMITED'] } } });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'This shop isn’t taking orders on Delivez');
    const products = await this.prisma.product.findMany({
      where: { storeId: store.id, id: { in: input.items.map((i) => i.productId) } },
      include: { variants: true, addonGroups: { include: { addons: true } }, inventory: true },
    });
    const now = new Date();
    const problems: Problem[] = [];
    const lines = input.items.map((it) => {
      const p = products.find((x) => x.id === it.productId);
      if (!p || p.deletedAt) {
        problems.push({ productId: it.productId, code: 'GONE', name: p?.name ?? '' });
        return null;
      }
      if (!p.isAvailable || (p.pausedUntil && p.pausedUntil > now)) problems.push({ productId: p.id, code: 'UNAVAILABLE', name: p.name });
      const left = p.inventory?.trackStock ? p.inventory.stockQty - p.inventory.reservedQty : null;
      if (left != null && left <= 0) problems.push({ productId: p.id, code: 'OUT_OF_STOCK', name: p.name });
      else if (left != null && left < it.qty) problems.push({ productId: p.id, code: 'FEW_LEFT', name: p.name, left });
      const variant = it.variantId ? p.variants.find((v) => v.id === it.variantId) : p.variants.find((v) => v.isDefault);
      const all = p.addonGroups.flatMap((g) => g.addons);
      const addons = (it.addonIds ?? []).map((id) => all.find((a) => a.id === id));
      const groupsOk = p.addonGroups.every((g) => {
        const n = (it.addonIds ?? []).filter((id) => g.addons.some((a) => a.id === id)).length;
        return n >= g.minSelect && (!g.maxSelect || n <= g.maxSelect);
      });
      if ((it.variantId && !variant) || addons.some((a) => !a) || !groupsOk) problems.push({ productId: p.id, code: 'OPTIONS_CHANGED', name: p.name });
      const unitPrice = p.price + (variant?.priceDiff ?? 0) + addons.reduce((s, a) => s + (a?.price ?? 0), 0);
      return { productId: p.id, variantId: variant?.id ?? null, addonIds: it.addonIds ?? [], name: p.name, qty: it.qty, unitPrice, lineTotal: unitPrice * it.qty, isRx: p.prescriptionRequired };
    });
    const priced = lines.filter((l): l is NonNullable<typeof l> => !!l);
    const items = priced.reduce((s, l) => s + l.lineTotal, 0);

    // Delivery: the saved address must be inside the shop's radius.
    let address: Awaited<ReturnType<LocalOrdersService['ownAddress']>> | null = null;
    let distanceKm: number | null = null;
    let outOfRange = false;
    if (input.fulfilmentType === 'DELIVERY' && input.addressId) {
      address = await this.ownAddress(userId, input.addressId);
      if (store.lat != null && store.lng != null) {
        distanceKm = Math.round(haversineKm(store.lat, store.lng, address.lat, address.lng) * 10) / 10;
        const radius = store.status === 'LIMITED' ? Math.min(LIMITED_RADIUS_KM, store.deliveryRadiusKm) : store.deliveryRadiusKm;
        outOfRange = distanceKm > radius;
      }
    }
    const delivery = input.fulfilmentType === 'DELIVERY' ? DELIVERY_FEE : 0;
    const packaging = store.vertical === 'EAT' ? store.packagingFee : 0;
    const blockers = [
      ...(store.openState === 'CLOSED' ? ['STORE_CLOSED'] : []),
      ...(input.fulfilmentType === 'DELIVERY' && !store.supportsDelivery ? ['DELIVERY_NOT_OFFERED'] : []),
      ...(input.fulfilmentType === 'PICKUP' && !store.supportsPickup ? ['PICKUP_NOT_OFFERED'] : []),
      ...(input.fulfilmentType === 'DELIVERY' && !input.addressId ? ['ADDRESS_REQUIRED'] : []),
      ...(outOfRange ? ['OUT_OF_RANGE'] : []),
      ...(items < store.minOrderAmount ? ['BELOW_MINIMUM'] : []),
      ...(store.vertical === 'DIAGNOSTICS' ? ['LAB_BOOKING'] : []),
      ...(priced.some((l) => l.isRx) ? ['RX_REQUIRED'] : []),
      ...(problems.length ? ['ITEMS'] : []),
    ];
    return {
      store: { id: store.id, name: store.name, slug: store.slug, vertical: store.vertical, supportsDelivery: store.supportsDelivery, supportsPickup: store.supportsPickup, minOrderAmount: store.minOrderAmount, open: store.openState !== 'CLOSED', address: store.addressLine1 },
      lines: priced,
      problems,
      distanceKm,
      totals: { items, delivery, packaging, discount: 0, grandTotal: items + delivery + packaging },
      blockers,
      canPlace: blockers.length === 0,
    };
  }

  async place(userId: string, input: CheckoutInput) {
    const q = await this.quote(userId, input);
    const first = q.blockers.find((b) => b !== 'ITEMS');
    if (first === 'STORE_CLOSED') throw new ApiError(HttpStatus.CONFLICT, 'STORE_CLOSED', 'The shop has just closed — try again when it opens');
    if (first === 'BELOW_MINIMUM') throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BELOW_MINIMUM', 'Add a little more to reach the shop’s minimum order', { minOrderAmount: q.store.minOrderAmount });
    if (first === 'ADDRESS_REQUIRED') throw new ApiError(HttpStatus.BAD_REQUEST, 'ADDRESS_REQUIRED', 'Choose a delivery address');
    if (first === 'OUT_OF_RANGE') throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'OUT_OF_RANGE', 'This shop doesn’t deliver to that address — try pickup or another address');
    if (first === 'LAB_BOOKING') throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'LAB_BOOKINGS_LATER', 'Lab tests are booked into a time slot — that’s coming to the app soon');
    if (first === 'RX_REQUIRED') throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'RX_REQUIRED', 'Prescription medicines need a prescription upload — that’s coming to the app soon');
    if (first) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, first, 'This order can’t be placed');
    if (q.problems.length) throw new ApiError(HttpStatus.CONFLICT, 'CART_CHANGED', 'Some items in your cart have changed', { problems: q.problems });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    await this.account.customer(userId);
    const a = input.fulfilmentType === 'DELIVERY' ? await this.ownAddress(userId, input.addressId!) : null;
    const order = await this.orders.create(
      {
        storeId: input.storeId,
        channel: 'LOCAL_WEB',
        fulfilmentType: input.fulfilmentType,
        customer: { phone: user.phone, name: user.fullName ?? undefined },
        items: input.items,
        paymentMode: input.paymentMode,
        addressId: a?.id,
        address: a
          ? {
              line1: [a.line1, a.line2].filter(Boolean).join(', '),
              landmark: a.landmark ?? undefined,
              pincode: a.pincode,
              lat: a.lat,
              lng: a.lng,
              contactName: a.contactName ?? undefined,
              contactPhone: a.contactPhone ? (a.contactPhone.startsWith('+') ? a.contactPhone : `+91${a.contactPhone.slice(-10)}`) : undefined,
            }
          : undefined,
        note: input.note,
      },
      { kind: 'CUSTOMER', userId },
    );
    return this.detail(userId, order.id);
  }

  async list(userId: string, cursor?: string) {
    const customer = await this.account.customer(userId);
    const rows = await this.prisma.order.findMany({
      where: { customerId: customer.id },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 21,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return { orders: rows.slice(0, 20).map((o) => this.view(o)), nextCursor: rows.length > 20 ? rows[19].id : null };
  }

  async detail(userId: string, idOrNumber: string) {
    const customer = await this.account.customer(userId);
    const where = /^DEL-\d+$/i.test(idOrNumber) ? { orderNumber: idOrNumber.toUpperCase() } : { id: idOrNumber };
    const o = await this.prisma.order.findFirst({ where: { ...where, customerId: customer.id }, include: ORDER_INCLUDE });
    if (!o) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    const events = await this.prisma.orderStatusEvent.findMany({ where: { orderId: o.id }, orderBy: { createdAt: 'asc' }, select: { toState: true, createdAt: true } });
    return { ...this.view(o), timeline: events.map((e) => ({ status: e.toState, at: e.createdAt })) };
  }

  /** Customers can cancel until the shop accepts. */
  async cancel(userId: string, orderId: string, reason?: string) {
    const o = await this.detail(userId, orderId);
    if (!['PLACED', 'AWAITING_RX_REVIEW'].includes(o.status)) throw new ApiError(HttpStatus.CONFLICT, 'TOO_LATE_TO_CANCEL', 'The shop has already started on your order — contact support to cancel');
    await this.state.transition(o.id, 'CANCEL', { kind: 'CUSTOMER', userId }, { reason: reason || 'Cancelled by customer' });
    return this.detail(userId, o.id);
  }

  /** What the customer sees: their codes (delivery / pickup OTP) but none of the shop's. */
  private view(o: Row) {
    const addr = (o.deliveryAddress ?? null) as { line1?: string; landmark?: string; pincode?: string; contactName?: string } | null;
    const task = o.deliveryTask;
    const active = !['DELIVERED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'DELIVERY_FAILED', 'REFUNDED'].includes(o.status);
    return {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      active,
      fulfilmentType: o.fulfilmentType,
      store: { id: o.store.id, name: o.store.name, slug: o.store.slug, vertical: o.store.vertical, address: o.store.addressLine1, phone: o.store.phone },
      address: addr ? [addr.line1, addr.landmark, addr.pincode].filter(Boolean).join(', ') : null,
      items: o.items.map((i) => ({ id: i.id, productId: i.productId, name: i.productName, variant: i.variantName, addons: (i.addons ?? []) as { name: string; price: number }[], qty: i.qty, unitPrice: i.unitPrice, lineTotal: i.lineTotal, unavailable: i.isOutOfStock, returnedQty: i.returnedQty })),
      totals: { items: o.itemsSubtotal, delivery: o.deliveryFee, packaging: o.packagingFee, discount: o.discountAmount, grandTotal: o.grandTotal },
      payment: { mode: o.paymentMode, status: o.paymentStatus },
      // The rider asks for this at the door; the shop asks for the pickup code at the counter.
      codes: active ? { delivery: o.fulfilmentType === 'DELIVERY' ? o.deliveryOtp : null, pickup: o.fulfilmentType === 'PICKUP' ? o.pickupOtp : null } : null,
      etaAt: o.currentEtaAt ?? o.promisedDeliveryAt,
      placedAt: o.placedAt ?? o.createdAt,
      deliveredAt: o.deliveredAt ?? o.completedAt,
      canCancel: ['PLACED', 'AWAITING_RX_REVIEW'].includes(o.status),
      cancelReason: o.status === 'REJECTED' ? o.rejectReason : o.cancelReason,
      note: o.customerNote,
      rider: task?.rider ? { name: task.rider.user.fullName?.split(/\s+/)[0] ?? null, phone: task.rider.user.phone, status: task.status } : null,
    };
  }

  private async ownAddress(userId: string, id: string) {
    const a = await this.prisma.address.findFirst({ where: { id, userId, deletedAt: null } });
    if (!a) throw new ApiError(HttpStatus.NOT_FOUND, 'ADDRESS_NOT_FOUND', 'Choose a delivery address');
    return a;
  }
}
