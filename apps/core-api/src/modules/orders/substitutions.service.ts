import { HttpStatus, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStateService, type OrderActor } from './order-state.service';
import { OrdersService } from './orders.service';

/** How long the customer has to answer before the substitute counts as declined. */
export const SUBSTITUTE_ANSWER_MINUTES = 5;
const OPEN: string[] = ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_SOON'];
const VERTICALS: string[] = ['GROCERY', 'LOCAL_STORES'];

/**
 * Grocery substitutes (plan §5.5): an item ran out, the store offers a replacement, the customer accepts or declines.
 * Accepted → the replacement joins the bill (price difference refunded if prepaid). Declined / no answer in
 * 5 minutes → the item is dropped and refunded, like "item unavailable". The order can't be marked ready while
 * an answer is pending.
 */
@Injectable()
export class SubstitutionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly orders: OrdersService,
  ) {}

  async propose(storeId: string, orderId: string, itemId: string, input: { productId: string; variantId?: string; qty: number; note?: string }, actor: OrderActor) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const o = await this.orders.mustOwn(storeId, orderId, tx);
      const store = await tx.store.findUniqueOrThrow({ where: { id: storeId }, select: { vertical: true, allowSubstitutions: true } });
      if (!VERTICALS.includes(store.vertical)) throw new ApiError(HttpStatus.CONFLICT, 'SUBSTITUTES_NOT_SUPPORTED', 'Substitutes are for grocery and local stores');
      if (!store.allowSubstitutions) throw new ApiError(HttpStatus.CONFLICT, 'SUBSTITUTES_OFF', 'Turn on substitutes in Settings → Operations first');
      if (!OPEN.includes(o.status)) throw new ApiError(HttpStatus.CONFLICT, 'ORDER_INVALID_TRANSITION', 'Substitutes can only be offered before the order is ready', { status: o.status });
      const item = await tx.orderItem.findFirst({ where: { id: itemId, orderId } });
      if (!item || item.isOutOfStock) throw new ApiError(HttpStatus.NOT_FOUND, 'ITEM_NOT_FOUND', 'Item not on this order');
      if (await tx.orderSubstitution.count({ where: { orderId, orderItemId: itemId, status: 'PROPOSED' } })) throw new ApiError(HttpStatus.CONFLICT, 'SUBSTITUTE_PENDING', 'A substitute for this item is already waiting for the customer');

      const p = await tx.product.findFirst({ where: { id: input.productId, storeId, deletedAt: null }, include: { variants: true } });
      const now = new Date();
      if (!p || !p.isAvailable || (p.pausedUntil && p.pausedUntil > now)) throw new ApiError(HttpStatus.CONFLICT, 'ITEM_UNAVAILABLE', 'That item is not available');
      if (p.prescriptionRequired) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'RX_SUBSTITUTE', 'Prescription items can’t be offered as substitutes');
      const variant = input.variantId ? p.variants.find((v) => v.id === input.variantId) : p.variants.find((v) => v.isDefault);
      if (input.variantId && !variant) throw new ApiError(HttpStatus.BAD_REQUEST, 'VARIANT_NOT_FOUND', `Unknown size for ${p.name}`);
      if (p.id === item.productId && (variant?.name ?? null) === item.variantName) throw new ApiError(HttpStatus.BAD_REQUEST, 'SAME_ITEM', 'Choose a different item');
      const unitPrice = p.price + (variant?.priceDiff ?? 0);
      const lineTotal = unitPrice * input.qty;
      // A prepaid customer can't be asked for more money from here, so the swap can't cost more.
      if (o.paymentStatus === 'CAPTURED' && lineTotal > item.lineTotal) {
        throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'SUBSTITUTE_COSTS_MORE', `This order is paid online — offer something that costs ₹${(item.lineTotal / 100).toFixed(0)} or less`, { maxLineTotal: item.lineTotal });
      }

      // Hold the replacement's stock now so it isn't sold while the customer decides.
      const inv = await tx.inventory.findUnique({ where: { productId: p.id } });
      if (inv?.trackStock) {
        const held = await tx.$executeRaw`UPDATE inventory SET "reservedQty" = "reservedQty" + ${input.qty}, "updatedAt" = now()
          WHERE "productId" = ${p.id} AND "trackStock" = true AND "stockQty" - "reservedQty" >= ${input.qty}`;
        if (!held) throw new ApiError(HttpStatus.CONFLICT, 'OUT_OF_STOCK', `${p.name} is out of stock`);
        await tx.inventoryMovement.create({ data: { inventoryId: inv.id, type: 'RESERVE', qtyDelta: -input.qty, orderId, note: `Substitute offered on ${o.orderNumber}`, actorUserId: actor.userId } });
      }
      const sub = await tx.orderSubstitution.create({
        data: {
          orderId,
          orderItemId: item.id,
          productId: p.id,
          productName: p.name,
          variantId: variant?.id ?? null,
          variantName: variant?.name ?? null,
          qty: input.qty,
          unitPrice,
          lineTotal,
          taxRatePct: p.taxRatePct,
          note: input.note,
          proposedByUserId: actor.userId,
          respondBy: new Date(now.getTime() + SUBSTITUTE_ANSWER_MINUTES * 60_000),
        },
      });
      await this.state.note(tx, o, 'order.substitution_proposed', actor, `${item.productName} → ${p.name}`, { substitutionId: sub.id, itemId: item.id, respondBy: sub.respondBy.toISOString() });
    });
    return this.orders.detailById(orderId);
  }

  /** The customer's answer (or SYSTEM when the time ran out). */
  async respond(orderId: string, substitutionId: string, accept: boolean, actor: OrderActor) {
    let cancelOrder = false;
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM orders WHERE id = ${orderId} FOR UPDATE`;
      const o = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
      const sub = await tx.orderSubstitution.findFirst({ where: { id: substitutionId, orderId } });
      if (!sub) throw new ApiError(HttpStatus.NOT_FOUND, 'SUBSTITUTE_NOT_FOUND', 'Substitute not found');
      if (sub.status !== 'PROPOSED') throw new ApiError(HttpStatus.CONFLICT, 'SUBSTITUTE_ANSWERED', 'This substitute was already answered');
      const item = await tx.orderItem.findUniqueOrThrow({ where: { id: sub.orderItemId } });
      const now = new Date();
      const expired = actor.kind === 'SYSTEM';
      const stillOpen = OPEN.includes(o.status);
      await tx.orderSubstitution.update({ where: { id: sub.id }, data: { status: !stillOpen ? 'EXPIRED' : accept ? 'ACCEPTED' : expired ? 'EXPIRED' : 'DECLINED', respondedAt: now } });

      if (accept && stillOpen) {
        // Swap: the old line is dropped (its stock released), the replacement joins the bill with its held stock.
        await tx.orderItem.update({ where: { id: item.id }, data: { isOutOfStock: true, substitutedProductId: sub.productId } });
        await this.state.releaseItem(tx, orderId, item.productId, item.qty, actor);
        await tx.orderItem.create({ data: { orderId, productId: sub.productId, productName: sub.productName, variantName: sub.variantName, unitPrice: sub.unitPrice, qty: sub.qty, taxRatePct: sub.taxRatePct, lineTotal: sub.lineTotal } });
        const delta = sub.lineTotal - item.lineTotal;
        await tx.order.update({ where: { id: orderId }, data: { itemsSubtotal: { increment: delta }, grandTotal: { increment: delta } } });
        if (delta < 0 && o.paymentStatus === 'CAPTURED') {
          const payment = await tx.payment.findFirst({ where: { orderId, status: 'CAPTURED' } });
          await tx.refund.create({ data: { orderId, paymentId: payment?.id, amount: -delta, reason: `${item.productName} replaced by ${sub.productName}`, initiatedBy: 'STORE' } });
        }
        await this.state.note(tx, o, 'order.substitution_accepted', actor, `${item.productName} → ${sub.productName}`, { substitutionId: sub.id, itemId: item.id, priceChange: delta });
        return;
      }

      // Declined / no answer / order moved on: give back the replacement's stock.
      await this.state.releaseItem(tx, orderId, sub.productId, sub.qty, actor);
      if (!stillOpen) return;
      const live = await tx.orderItem.count({ where: { orderId, isOutOfStock: false } });
      if (live <= 1) {
        cancelOrder = true; // nothing left to send — cancel and refund the whole order below
      } else {
        await tx.orderItem.update({ where: { id: item.id }, data: { isOutOfStock: true } });
        await this.state.releaseItem(tx, orderId, item.productId, item.qty, actor);
        await tx.order.update({ where: { id: orderId }, data: { itemsSubtotal: { decrement: item.lineTotal }, grandTotal: { decrement: item.lineTotal } } });
        if (o.paymentStatus === 'CAPTURED') {
          const payment = await tx.payment.findFirst({ where: { orderId, status: 'CAPTURED' } });
          await tx.refund.create({ data: { orderId, paymentId: payment?.id, amount: item.lineTotal, reason: `${item.productName} unavailable`, initiatedBy: 'STORE' } });
        }
      }
      await this.state.note(tx, o, 'order.substitution_declined', actor, expired ? `No answer — ${item.productName} removed` : `Customer declined ${sub.productName}`, { substitutionId: sub.id, itemId: item.id, expired, refund: o.paymentStatus === 'CAPTURED' ? item.lineTotal : 0 });
    });
    if (cancelOrder) {
      await this.state.transition(orderId, 'CANCEL', { kind: 'SYSTEM' }, { reason: 'The only item ran out and the substitute was not accepted', meta: { auto: 'SUBSTITUTE_DECLINED' } });
    }
    return this.orders.detailById(orderId);
  }

  /** Substitutes nobody answered in time. Called by the order jobs tick. */
  async expireDue(now = new Date()) {
    const due = await this.prisma.orderSubstitution.findMany({ where: { status: 'PROPOSED', respondBy: { lt: now } }, select: { id: true, orderId: true }, take: 100 });
    for (const s of due) await this.respond(s.orderId, s.id, false, { kind: 'SYSTEM' }).catch(() => undefined);
    return due.length;
  }
}
