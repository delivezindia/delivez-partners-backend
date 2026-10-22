import { HttpStatus, Injectable } from '@nestjs/common';
import type { DeliveryTaskStatus, OrderStatus, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { checkTransition, type ActorKind, type OrderAction } from './order-state';

export interface OrderActor {
  kind: ActorKind;
  userId?: string;
  role?: string;
  correlationId?: string;
}

export interface TransitionOptions {
  reason?: string | null;
  meta?: Record<string, unknown>;
  /** ACCEPT: minutes the store commits to. */
  prepMinutes?: number;
  /** READY_SOON: the upper bound of the window ("ready in 5–10 min" → 10). */
  windowMinutes?: number;
  /** HANDOVER: how the rider was verified. */
  verifiedBy?: 'OTP' | 'QR' | 'MANUAL';
}

const EVENT: Record<OrderAction, string> = {
  ACCEPT: 'order.accepted',
  REJECT: 'order.rejected',
  START_PREPARING: 'order.preparing',
  READY_SOON: 'order.ready_soon',
  MARK_READY: 'order.ready',
  HANDOVER: 'order.picked_up',
  PICKUP_COMPLETE: 'order.completed',
  OUT_FOR_DELIVERY: 'order.out_for_delivery',
  ARRIVE: 'order.arrived',
  DELIVER: 'order.delivered',
  FAIL_DELIVERY: 'order.delivery_failed',
  CANCEL: 'order.cancelled',
};

const ERROR_STATUS = {
  ACTOR_NOT_ALLOWED: HttpStatus.FORBIDDEN,
  WRONG_FULFILMENT: HttpStatus.CONFLICT,
  ORDER_INVALID_TRANSITION: HttpStatus.CONFLICT,
  REASON_REQUIRED: HttpStatus.BAD_REQUEST,
} as const;

/** Rough rider travel time until dispatch provides a real ETA. */
export const travelMinutes = (km: number | null | undefined) => Math.ceil((km ?? 3) * 3) + 5;

type OrderForTransition = Prisma.OrderGetPayload<{ include: { items: true; deliveryTask: true; store: true } }>;

/**
 * The only writer of orders.status (plan §10.1). Every transition: row lock → rule check → state + timestamps →
 * side effects (stock, delivery task, refund stub) → order_status_events row → outbox event, in one transaction.
 */
@Injectable()
export class OrderStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  async transition(orderId: string, action: OrderAction, actor: OrderActor, opts: TransitionOptions = {}) {
    return this.prisma.$transaction(async (tx) => {
      // Serialises concurrent actions on the same order (e.g. store accepts as the timeout fires).
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { items: true, deliveryTask: true, store: true } });
      if (!order) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');

      const check = checkTransition(action, order, actor.kind, opts.reason);
      if (!check.ok) throw new ApiError(ERROR_STATUS[check.code], check.code, check.message, { status: order.status });
      const to = check.to;
      const now = new Date();
      const data: Prisma.OrderUpdateInput = { status: to };
      const eventData: Record<string, unknown> = {};

      switch (action) {
        case 'ACCEPT': {
          const busy = order.store.openState === 'BUSY';
          const prep = opts.prepMinutes ?? order.store.defaultPrepMinutes + (busy ? 10 : 0);
          const travel = order.fulfilmentType === 'DELIVERY' ? travelMinutes(order.deliveryDistanceKm) : 0;
          Object.assign(data, { acceptedAt: now, promisedPrepMinutes: prep, currentEtaAt: addMin(now, prep + travel) });
          eventData.prepMinutes = prep;
          if (order.fulfilmentType === 'DELIVERY' && !order.deliveryTask) await this.createTask(tx, order, addMin(now, prep));
          break;
        }
        case 'REJECT':
          Object.assign(data, { rejectReason: opts.reason, cancelledAt: now, cancelledBy: actor.kind === 'SYSTEM' ? 'SYSTEM' : 'STORE' });
          await this.release(tx, order, actor);
          Object.assign(data, await this.refundStub(tx, order, opts.reason!, actor.kind === 'SYSTEM' ? 'SYSTEM' : 'STORE'));
          if (order.deliveryTask) await this.setTask(tx, order.deliveryTask, 'CANCELLED', {}, actor.kind);
          break;
        case 'START_PREPARING':
          data.preparingAt = now;
          break;
        case 'READY_SOON': {
          const window = opts.windowMinutes ?? 10;
          Object.assign(data, { readySoonAt: now, readySoonWindowMin: window });
          if (order.deliveryTask) await this.setTask(tx, order.deliveryTask, null, { readyAtEstimate: addMin(now, window) }, actor.kind);
          eventData.windowMinutes = window;
          break;
        }
        case 'MARK_READY':
          Object.assign(data, { readyAt: now, currentEtaAt: order.fulfilmentType === 'DELIVERY' ? addMin(now, travelMinutes(order.deliveryDistanceKm)) : now });
          if (order.deliveryTask) await this.setTask(tx, order.deliveryTask, null, { readyAtEstimate: now }, actor.kind);
          break;
        case 'HANDOVER':
          data.pickedUpAt = now;
          await this.sell(tx, order, actor);
          if (order.deliveryTask) await this.setTask(tx, order.deliveryTask, 'PICKED_UP', { pickedUpAt: now, handoverVerifiedBy: opts.verifiedBy ?? 'MANUAL' }, actor.kind);
          eventData.verifiedBy = opts.verifiedBy ?? 'MANUAL';
          break;
        case 'PICKUP_COMPLETE':
          Object.assign(data, { pickedUpAt: now, completedAt: now, ...(order.paymentMode === 'COD' ? { paymentStatus: 'COD_COLLECTED' as const } : {}) });
          await this.sell(tx, order, actor);
          break;
        case 'OUT_FOR_DELIVERY':
          if (order.deliveryTask) await this.setTask(tx, order.deliveryTask, 'EN_ROUTE_TO_DROP', {}, actor.kind);
          break;
        case 'ARRIVE':
          if (order.deliveryTask) await this.setTask(tx, order.deliveryTask, 'ARRIVED_AT_DROP', { arrivedDropAt: now }, actor.kind);
          break;
        case 'DELIVER':
          Object.assign(data, { deliveredAt: now, ...(order.paymentMode === 'COD' ? { paymentStatus: 'COD_COLLECTED' as const } : {}) });
          if (order.deliveryTask) await this.setTask(tx, order.deliveryTask, 'DELIVERED', { deliveredAt: now, codCollected: order.paymentMode === 'COD' }, actor.kind);
          break;
        case 'FAIL_DELIVERY':
          if (order.deliveryTask) await this.setTask(tx, order.deliveryTask, 'FAILED', { failedReason: opts.reason }, actor.kind);
          break;
        case 'CANCEL':
          Object.assign(data, { cancelledAt: now, cancelledBy: actor.kind, cancelReason: opts.reason });
          await this.release(tx, order, actor);
          Object.assign(data, await this.refundStub(tx, order, opts.reason!, actor.kind === 'ADMIN' ? 'ADMIN' : 'SYSTEM'));
          if (order.deliveryTask && !['DELIVERED', 'CANCELLED', 'FAILED'].includes(order.deliveryTask.status)) {
            await this.setTask(tx, order.deliveryTask, 'CANCELLED', {}, actor.kind);
          }
          break;
      }

      const updated = await tx.order.update({ where: { id: orderId }, data, select: { id: true, status: true, orderNumber: true } });
      await tx.orderStatusEvent.create({
        data: { orderId, fromState: order.status, toState: to, actorType: actor.kind, actorId: actor.userId, reason: opts.reason ?? null, meta: (opts.meta ?? undefined) as Prisma.InputJsonValue | undefined },
      });
      await this.events.publish(tx, {
        type: EVENT[action],
        data: { storeId: order.storeId, orderId, orderNumber: order.orderNumber, from: order.status, to, reason: opts.reason ?? undefined, ...eventData },
        actor: { type: actor.kind, userId: actor.userId, role: actor.role },
        correlationId: actor.correlationId,
      });
      return { orderId, orderNumber: updated.orderNumber, from: order.status as OrderStatus, to };
    });
  }

  /** Records a non-state event on the timeline (delay, item unavailable) inside an existing transaction. */
  async note(tx: Prisma.TransactionClient, order: { id: string; storeId: string; orderNumber: string; status: OrderStatus }, type: string, actor: OrderActor, reason: string | null, meta: Record<string, unknown>) {
    await tx.orderStatusEvent.create({ data: { orderId: order.id, fromState: order.status, toState: order.status, actorType: actor.kind, actorId: actor.userId, reason, meta: meta as Prisma.InputJsonValue } });
    await this.events.publish(tx, {
      type,
      data: { storeId: order.storeId, orderId: order.id, orderNumber: order.orderNumber, status: order.status, reason: reason ?? undefined, ...meta },
      actor: { type: actor.kind, userId: actor.userId, role: actor.role },
      correlationId: actor.correlationId,
    });
  }

  // ------------------------------------------------------------------
  // Stock: reserve on PLACED (OrdersService), SALE on handover/pickup, RELEASE on reject/cancel
  // ------------------------------------------------------------------

  async release(tx: Prisma.TransactionClient, order: OrderForTransition, actor: OrderActor) {
    for (const item of order.items.filter((i) => !i.isOutOfStock)) await this.releaseItem(tx, order.id, item.productId, item.qty, actor);
  }

  async releaseItem(tx: Prisma.TransactionClient, orderId: string, productId: string, qty: number, actor: OrderActor) {
    const inv = await tx.inventory.findUnique({ where: { productId } });
    if (!inv?.trackStock) return;
    await tx.inventory.update({ where: { id: inv.id }, data: { reservedQty: Math.max(0, inv.reservedQty - qty) } });
    await tx.inventoryMovement.create({ data: { inventoryId: inv.id, type: 'RELEASE', qtyDelta: qty, orderId, note: 'Order not fulfilled', actorUserId: actor.userId } });
  }

  private async sell(tx: Prisma.TransactionClient, order: OrderForTransition, actor: OrderActor) {
    for (const item of order.items.filter((i) => !i.isOutOfStock)) {
      const inv = await tx.inventory.findUnique({ where: { productId: item.productId }, include: { product: { select: { name: true } } } });
      if (!inv?.trackStock) continue;
      const after = await tx.inventory.update({
        where: { id: inv.id },
        data: { stockQty: Math.max(0, inv.stockQty - item.qty), reservedQty: Math.max(0, inv.reservedQty - item.qty) },
      });
      await tx.inventoryMovement.create({ data: { inventoryId: inv.id, type: 'SALE', qtyDelta: -item.qty, orderId: order.id, note: `Order ${order.orderNumber}`, actorUserId: actor.userId } });
      const before = inv.stockQty - inv.reservedQty;
      const available = after.stockQty - after.reservedQty;
      if (before > inv.lowStockThreshold && available <= inv.lowStockThreshold) {
        await this.events.publish(tx, {
          type: 'inventory.low_stock',
          data: { storeId: order.storeId, productId: item.productId, name: inv.product.name, available, threshold: inv.lowStockThreshold },
          actor: { type: 'SYSTEM' },
        });
      }
    }
  }

  // ------------------------------------------------------------------
  // Refunds — stub until the payments module lands (plan §10: refund hook)
  // ------------------------------------------------------------------

  private async refundStub(tx: Prisma.TransactionClient, order: OrderForTransition, reason: string, initiatedBy: string): Promise<Prisma.OrderUpdateInput> {
    if (!['CAPTURED', 'AUTHORIZED'].includes(order.paymentStatus)) return {};
    const payment = await tx.payment.findFirst({ where: { orderId: order.id, status: { in: ['CAPTURED', 'AUTHORIZED'] } } });
    const refunded = await tx.refund.aggregate({ where: { orderId: order.id }, _sum: { amount: true } });
    const amount = order.grandTotal - (refunded._sum.amount ?? 0);
    if (amount > 0) {
      await tx.refund.create({ data: { orderId: order.id, paymentId: payment?.id, amount, reason, initiatedBy } });
      await this.events.publish(tx, { type: 'payment.refund_initiated', data: { storeId: order.storeId, orderId: order.id, amount, reason }, actor: { type: 'SYSTEM' } });
    }
    return { paymentStatus: 'REFUND_PENDING' };
  }

  // ------------------------------------------------------------------
  // Delivery task (dispatch stub — plan §8 manual mode)
  // ------------------------------------------------------------------

  private async createTask(tx: Prisma.TransactionClient, order: OrderForTransition, readyAt: Date) {
    const s = order.store;
    const drop = (order.deliveryAddress ?? {}) as { lat?: number; lng?: number; contactPhone?: string };
    const task = await tx.deliveryTask.create({
      data: {
        orderId: order.id,
        status: 'SEARCHING_RIDER',
        searchStartedAt: new Date(),
        pickupLat: s.lat ?? 0,
        pickupLng: s.lng ?? 0,
        pickupAddress: { name: s.name, line1: s.addressLine1, landmark: s.landmark, pincode: s.pincode },
        pickupContactPhone: s.phone ?? '',
        dropLat: drop.lat ?? 0,
        dropLng: drop.lng ?? 0,
        dropAddress: (order.deliveryAddress ?? {}) as Prisma.InputJsonValue,
        dropContactPhone: drop.contactPhone ?? '',
        distanceKm: order.deliveryDistanceKm,
        readyAtEstimate: readyAt,
        codToCollect: order.paymentMode === 'COD' ? order.grandTotal : 0,
      },
    });
    await tx.deliveryTaskEvent.create({ data: { taskId: task.id, toState: 'SEARCHING_RIDER', actorType: 'SYSTEM' } });
    await this.events.publish(tx, { type: 'delivery.task_updated', data: { storeId: order.storeId, orderId: order.id, taskId: task.id, status: 'SEARCHING_RIDER' }, actor: { type: 'SYSTEM' } });
  }

  /** Updates the task (status optional) with an event row and a realtime event for the store screen. */
  async setTask(tx: Prisma.TransactionClient, task: { id: string; orderId: string | null; status: DeliveryTaskStatus }, status: DeliveryTaskStatus | null, data: Prisma.DeliveryTaskUpdateInput, actorType: string, storeId?: string) {
    await tx.deliveryTask.update({ where: { id: task.id }, data: { ...data, ...(status ? { status } : {}) } });
    if (!status || status === task.status) return;
    await tx.deliveryTaskEvent.create({ data: { taskId: task.id, fromState: task.status, toState: status, actorType } });
    const sid = storeId ?? (task.orderId ? (await tx.order.findUnique({ where: { id: task.orderId }, select: { storeId: true } }))?.storeId : undefined);
    await this.events.publish(tx, { type: 'delivery.task_updated', data: { storeId: sid, orderId: task.orderId, taskId: task.id, status }, actor: { type: actorType } });
  }
}

const addMin = (d: Date, m: number) => new Date(d.getTime() + m * 60_000);
