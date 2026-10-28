import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStateService, type OrderActor } from './order-state.service';
import { OrdersService } from './orders.service';
import { checkReturn, windowState, type ReturnRequest } from './returns-rules';

/**
 * Doorstep returns (see returns-rules.ts). The rider (or ops, playing the rider until the rider app exists)
 * records what the customer handed back; the customer is refunded at once; the shop confirms when the items
 * are back and whether they go back on the shelf.
 */
@Injectable()
export class ReturnsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly orders: OrdersService,
  ) {}

  /** Items handed back at the door. Closes the window — the rider leaves with them. */
  async create(orderId: string, req: ReturnRequest[], note: string | undefined, actor: OrderActor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const o = await tx.order.findUnique({ where: { id: orderId }, include: { items: true } });
      if (!o) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
      if (o.status !== 'DELIVERED' || windowState(o) !== 'OPEN') {
        throw new ApiError(HttpStatus.CONFLICT, 'RETURN_WINDOW_CLOSED', windowState(o) === 'NONE' ? 'This order has no doorstep return window' : 'The 5-minute return window has closed');
      }
      const check = checkReturn(o.items, req);
      if (!check.ok) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, check.code, check.message);

      const cash = o.paymentMode === 'COD';
      const payment = cash ? null : await tx.payment.findFirst({ where: { orderId, status: 'CAPTURED' } });
      const now = new Date();
      for (const line of check.lines) {
        const item = o.items.find((i) => i.id === line.itemId)!;
        await tx.orderItem.update({ where: { id: item.id }, data: { returnedQty: { increment: line.qty } } });
        await tx.orderReturn.create({
          data: {
            orderId,
            orderItemId: item.id,
            productId: item.productId,
            productName: item.productName,
            qty: line.qty,
            amount: line.amount,
            reason: line.reason,
            note,
            status: line.reason === 'MISSING' ? 'NOT_APPLICABLE' : 'WITH_RIDER',
            refundMethod: cash ? 'CASH_AT_DOOR' : 'ONLINE',
            createdByType: actor.kind === 'RIDER' || actor.kind === 'CUSTOMER' ? actor.kind : 'ADMIN',
            createdByUserId: actor.userId,
          },
        });
        await tx.refund.create({
          data: { orderId, paymentId: payment?.id, amount: line.amount, reason: `${item.productName} returned at the door (${line.reason.toLowerCase().replace('_', ' ')})`, initiatedBy: actor.kind === 'RIDER' || actor.kind === 'CUSTOMER' ? actor.kind : 'ADMIN', ...(cash ? { status: 'PROCESSED', processedAt: now } : {}) },
        });
      }
      // The bill (and so sales reports and GST) shrink by what came back.
      await tx.order.update({
        where: { id: orderId },
        data: { itemsSubtotal: { decrement: check.total }, grandTotal: { decrement: check.total }, returnWindowClosedAt: now, returnWindowOutcome: 'RETURNED' },
      });
      const withRider = check.lines.filter((l) => l.reason !== 'MISSING').reduce((n, l) => n + l.qty, 0);
      await this.state.note(tx, o, 'order.return_created', actor, `${check.lines.length} item(s) returned at the door`, { amount: check.total, withRider, refundMethod: cash ? 'CASH_AT_DOOR' : 'ONLINE', items: check.lines.map((l) => ({ itemId: l.itemId, qty: l.qty, reason: l.reason })) });
    });
    return this.orders.detailById(orderId);
  }

  /** "Customer is happy" — the rider can leave. */
  async close(orderId: string, actor: OrderActor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      if (windowState(o) !== 'OPEN') throw new ApiError(HttpStatus.CONFLICT, 'RETURN_WINDOW_CLOSED', 'The return window is already closed');
      await tx.order.update({ where: { id: orderId }, data: { returnWindowClosedAt: new Date(), returnWindowOutcome: 'NO_RETURN' } });
      await this.state.note(tx, o, 'order.return_window_closed', actor, 'Customer checked the items — all good', { outcome: 'NO_RETURN' });
    });
    return this.orders.detailById(orderId);
  }

  /** Windows that ran out without a decision. Called by the order jobs tick. */
  async expireDue(now = new Date()) {
    const due = await this.prisma.order.findMany({ where: { returnWindowClosedAt: null, returnWindowEndsAt: { lt: now } }, select: { id: true, returnWindowEndsAt: true }, take: 200 });
    for (const o of due) {
      await this.prisma.order.updateMany({ where: { id: o.id, returnWindowClosedAt: null }, data: { returnWindowClosedAt: o.returnWindowEndsAt, returnWindowOutcome: 'EXPIRED' } });
    }
    return due.length;
  }

  /** The shop has the item back: on the shelf again (stock +qty), or damaged (no stock change). */
  async receive(storeId: string, orderId: string, returnId: string, restock: boolean, actor: OrderActor) {
    await this.prisma.$transaction(async (tx) => {
      const o = await this.orders.mustOwn(storeId, orderId, tx);
      const r = await tx.orderReturn.findFirst({ where: { id: returnId, orderId } });
      if (!r) throw new ApiError(HttpStatus.NOT_FOUND, 'RETURN_NOT_FOUND', 'Return not found');
      if (r.status !== 'WITH_RIDER') throw new ApiError(HttpStatus.CONFLICT, 'RETURN_ALREADY_RECEIVED', 'Already marked as received');
      await tx.orderReturn.update({ where: { id: r.id }, data: { status: 'RECEIVED', restocked: restock, receivedAt: new Date(), receivedByUserId: actor.userId } });
      const inv = await tx.inventory.findUnique({ where: { productId: r.productId } });
      if (inv?.trackStock) {
        if (restock) await tx.inventory.update({ where: { id: inv.id }, data: { stockQty: { increment: r.qty } } });
        await tx.inventoryMovement.create({ data: { inventoryId: inv.id, type: restock ? 'RETURN' : 'ADJUSTMENT', qtyDelta: restock ? r.qty : 0, orderId, note: restock ? `Returned on ${o.orderNumber}, back on shelf` : `Returned damaged on ${o.orderNumber} — not restocked`, actorUserId: actor.userId } });
      }
      await this.state.note(tx, o, 'order.return_received', actor, `${r.productName} back at the shop${restock ? '' : ' (damaged)'}`, { returnId: r.id, restocked: restock });
    });
    return this.orders.detailById(orderId);
  }
}
