import { HttpStatus, Injectable } from '@nestjs/common';
import type { DeliveryTaskStatus, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStateService, type OrderActor } from './order-state.service';
import { handoverQr, maskPhone, OrdersService } from './orders.service';

const TEST_RIDER_PHONE = '+919999988888';

/** Rider-side steps the admin can play while the rider app doesn't exist (plan §8 manual dispatch). */
export const TASK_STEPS = ['EN_ROUTE_TO_PICKUP', 'ARRIVED_AT_PICKUP', 'PICKED_UP', 'EN_ROUTE_TO_DROP', 'ARRIVED_AT_DROP', 'DELIVERED', 'FAILED'] as const;
export type TaskStep = (typeof TASK_STEPS)[number];

const ALLOWED_FROM: Record<TaskStep, DeliveryTaskStatus[]> = {
  EN_ROUTE_TO_PICKUP: ['ASSIGNED'],
  ARRIVED_AT_PICKUP: ['ASSIGNED', 'EN_ROUTE_TO_PICKUP'],
  PICKED_UP: ['ARRIVED_AT_PICKUP', 'WAITING_AT_PICKUP'],
  EN_ROUTE_TO_DROP: ['PICKED_UP'],
  ARRIVED_AT_DROP: ['EN_ROUTE_TO_DROP'],
  DELIVERED: ['EN_ROUTE_TO_DROP', 'ARRIVED_AT_DROP'],
  FAILED: ['PICKED_UP', 'EN_ROUTE_TO_DROP', 'ARRIVED_AT_DROP'],
};

/** Dispatch stub + admin order tools (Step 10). Real assignment comes with the rider app / dispatch engine. */
@Injectable()
export class DispatchService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly orders: OrdersService,
  ) {}

  /** City-scoped admins only see orders of stores in their cities (empty = all cities). */
  private scope(cityIds: string[]): Prisma.OrderWhereInput {
    return cityIds.length ? { store: { cityId: { in: cityIds } } } : {};
  }

  /** 404 (not 403) for another city's order, so its existence isn't revealed. */
  private async assertInScope(orderId: string, cityIds: string[]) {
    if (!cityIds.length) return;
    const ok = await this.prisma.order.count({ where: { id: orderId, ...this.scope(cityIds) } });
    if (!ok) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
  }

  async adminList(q: { storeId?: string; status?: string; q?: string; limit: number; before?: string }, cityIds: string[] = []) {
    const scope = this.scope(cityIds);
    const today = new Date(Date.now() - ((Date.now() + 5.5 * 3600_000) % 86_400_000));
    const [rows, active, todayCount, missedToday] = await Promise.all([
      this.prisma.order.findMany({
      where: {
        ...scope,
        ...(q.before ? { placedAt: { lt: new Date(q.before) } } : {}),
        ...(q.storeId ? { storeId: q.storeId } : {}),
        ...(q.status === 'ACTIVE' ? { status: { in: ['AWAITING_RX_REVIEW', 'PLACED', 'ACCEPTED', 'PREPARING', 'READY_SOON', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED'] } } : q.status ? { status: q.status as never } : {}),
        ...(q.q ? { orderNumber: { contains: q.q.toUpperCase() } } : {}),
      },
      orderBy: { placedAt: 'desc' },
      take: q.limit + 1,
      include: { store: { select: { id: true, name: true, city: { select: { name: true } } } }, deliveryTask: { select: { id: true, status: true } } },
      }),
      this.prisma.order.count({ where: { ...scope, status: { in: ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_SOON', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED'] } } }),
      this.prisma.order.count({ where: { ...scope, placedAt: { gte: today } } }),
      this.prisma.orderStatusEvent.count({ where: { toState: 'REJECTED', actorType: 'SYSTEM', createdAt: { gte: today }, order: scope } }),
    ]);
    const page = rows.slice(0, q.limit);
    const items = page.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      fulfilmentType: o.fulfilmentType,
      grandTotal: o.grandTotal,
      paymentMode: o.paymentMode,
      isTestOrder: o.isTestOrder,
      placedAt: o.placedAt,
      store: { id: o.store.id, name: o.store.name, city: o.store.city?.name ?? null },
      task: o.deliveryTask,
    }));
    return { items, counts: { active, today: todayCount, missedToday }, nextBefore: rows.length > q.limit ? page[page.length - 1].placedAt?.toISOString() ?? null : null };
  }

  /** Admin detail. In dev the codes are included so an admin can play the rider/customer. */
  async adminDetail(orderId: string, cityIds: string[] = []) {
    await this.assertInScope(orderId, cityIds);
    const o = await this.prisma.order.findUnique({ where: { id: orderId }, include: { store: { select: { id: true, name: true } }, deliveryTask: true } });
    if (!o) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    const view = await this.orders.detailById(orderId);
    const dev = process.env.NODE_ENV !== 'production';
    return {
      ...view,
      store: o.store,
      task: o.deliveryTask ? { id: o.deliveryTask.id, status: o.deliveryTask.status } : null,
      codes: dev ? { handoverOtp: o.handoverOtp, handoverQr: o.handoverOtp ? handoverQr(o.id, o.handoverOtp) : null, pickupOtp: o.pickupOtp, deliveryOtp: o.deliveryOtp } : undefined,
    };
  }

  async cancel(orderId: string, reason: string, actor: OrderActor, cityIds: string[] = []) {
    await this.assertInScope(orderId, cityIds);
    await this.state.transition(orderId, 'CANCEL', actor, { reason });
    return this.adminDetail(orderId);
  }

  /** Assigns the shared test rider (created on first use). */
  async assign(taskId: string, actor: OrderActor, cityIds: string[] = []) {
    const task = await this.prisma.deliveryTask.findUnique({ where: { id: taskId } });
    if (!task) throw new ApiError(HttpStatus.NOT_FOUND, 'TASK_NOT_FOUND', 'Delivery task not found');
    if (task.orderId) await this.assertInScope(task.orderId, cityIds);
    if (!['CREATED', 'SEARCHING_RIDER'].includes(task.status)) throw new ApiError(HttpStatus.CONFLICT, 'TASK_ALREADY_ASSIGNED', `Task is ${task.status.toLowerCase()}`);
    const rider = await this.testRider();
    await this.prisma.$transaction(async (tx) => {
      await this.state.setTask(tx, task, 'ASSIGNED', { rider: { connect: { id: rider.id } }, assignedAt: new Date(), etaToPickupMin: 6 }, actor.kind);
    });
    return { taskId, status: 'ASSIGNED', rider: { name: rider.user.fullName, phone: maskPhone(rider.user.phone) } };
  }

  /** Moves the task like the rider app would, and keeps the order in step. */
  async step(taskId: string, step: TaskStep, reason: string | undefined, actor: OrderActor, cityIds: string[] = []) {
    const task = await this.prisma.deliveryTask.findUnique({ where: { id: taskId }, include: { order: { select: { id: true, status: true } } } });
    if (!task?.order) throw new ApiError(HttpStatus.NOT_FOUND, 'TASK_NOT_FOUND', 'Delivery task not found');
    await this.assertInScope(task.order.id, cityIds);
    if (!ALLOWED_FROM[step].includes(task.status)) {
      throw new ApiError(HttpStatus.CONFLICT, 'TASK_INVALID_TRANSITION', `A ${task.status.toLowerCase().replace(/_/g, ' ')} task cannot move to ${step.toLowerCase().replace(/_/g, ' ')}`);
    }
    const orderId = task.order.id;
    const now = new Date();
    switch (step) {
      case 'EN_ROUTE_TO_PICKUP':
        await this.prisma.$transaction((tx) => this.state.setTask(tx, task, 'EN_ROUTE_TO_PICKUP', {}, actor.kind));
        break;
      case 'ARRIVED_AT_PICKUP': {
        // Rider waits if the order isn't ready yet — the store screen shows the waiting timer.
        const waiting = task.order.status !== 'READY';
        await this.prisma.$transaction((tx) => this.state.setTask(tx, task, waiting ? 'WAITING_AT_PICKUP' : 'ARRIVED_AT_PICKUP', { arrivedPickupAt: now, ...(waiting ? { waitingStartedAt: now } : {}) }, actor.kind));
        break;
      }
      case 'PICKED_UP':
        await this.state.transition(orderId, 'HANDOVER', actor, { verifiedBy: 'MANUAL' });
        break;
      case 'EN_ROUTE_TO_DROP':
        await this.state.transition(orderId, 'OUT_FOR_DELIVERY', actor);
        break;
      case 'ARRIVED_AT_DROP':
        await this.state.transition(orderId, 'ARRIVE', actor);
        break;
      case 'DELIVERED':
        await this.state.transition(orderId, 'DELIVER', actor);
        break;
      case 'FAILED':
        await this.state.transition(orderId, 'FAIL_DELIVERY', actor, { reason: reason || 'Delivery failed' });
        break;
    }
    return this.adminDetail(orderId);
  }

  private async testRider() {
    const existing = await this.prisma.rider.findFirst({ where: { user: { phone: TEST_RIDER_PHONE } }, include: { user: true } });
    if (existing) return existing;
    const user = await this.prisma.user.upsert({ where: { phone: TEST_RIDER_PHONE }, update: {}, create: { phone: TEST_RIDER_PHONE, fullName: 'Ravi (test rider)', phoneVerified: true } });
    return this.prisma.rider.create({ data: { userId: user.id, riderCode: 'DZR-TEST1', status: 'ACTIVE', vehicleType: 'BIKE', isOnline: true }, include: { user: true } });
  }
}
