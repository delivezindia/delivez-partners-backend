import { HttpStatus, Injectable } from '@nestjs/common';
import type { InventoryMovementType } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from '../onboarding/onboarding.service';
import { PRODUCT_INCLUDE, toProductView } from './catalog.service';

const EXPIRY_WARNING_DAYS = 30;

// Stock is a running number plus an append-only movement log (plan §5.4.1, §9.4).
@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  async list(storeId: string, filter: 'ALL' | 'LOW' | 'OUT' | 'EXPIRING' = 'ALL') {
    const rows = await this.prisma.product.findMany({
      where: { storeId, deletedAt: null, inventory: { trackStock: true } },
      include: PRODUCT_INCLUDE,
      orderBy: { name: 'asc' },
    });
    const soon = new Date(Date.now() + EXPIRY_WARNING_DAYS * 864e5);
    const items = rows.map((r) => ({ ...toProductView(r), expiringSoon: !!r.inventory?.expiryDate && r.inventory.expiryDate <= soon }));
    const counts = {
      ALL: items.length,
      LOW: items.filter((i) => i.inventory!.isLow && i.inventory!.available! > 0).length,
      OUT: items.filter((i) => i.inventory!.available! <= 0).length,
      EXPIRING: items.filter((i) => i.expiringSoon).length,
    };
    const filtered =
      filter === 'LOW' ? items.filter((i) => i.inventory!.isLow && i.inventory!.available! > 0) : filter === 'OUT' ? items.filter((i) => i.inventory!.available! <= 0) : filter === 'EXPIRING' ? items.filter((i) => i.expiringSoon) : items;
    const untracked = await this.prisma.product.count({ where: { storeId, deletedAt: null, OR: [{ inventory: null }, { inventory: { trackStock: false } }] } });
    return { items: filtered, counts, untracked };
  }

  async change(storeId: string, productId: string, input: { mode: 'SET' | 'ADJUST'; qty: number; type: InventoryMovementType; note?: string }, actor: Actor) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, storeId, deletedAt: null }, include: { inventory: true } });
    if (!product) throw new ApiError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Item not found');

    const updated = await this.prisma.$transaction(async (tx) => {
      const inv = product.inventory ?? (await tx.inventory.create({ data: { productId, trackStock: true, stockQty: 0 } }));
      // Re-read inside the transaction; reserved stock can change with live orders.
      const current = await tx.inventory.findUniqueOrThrow({ where: { id: inv.id } });
      const next = input.mode === 'SET' ? input.qty : current.stockQty + input.qty;
      if (next < 0) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'STOCK_NEGATIVE', `Only ${current.stockQty} in stock`);
      const delta = next - current.stockQty;
      if (delta === 0 && current.trackStock) return current;
      const row = await tx.inventory.update({
        where: { id: inv.id },
        data: {
          stockQty: next,
          trackStock: true,
          movements: delta ? { create: { type: input.mode === 'SET' && input.type === 'PURCHASE' && delta < 0 ? 'ADJUSTMENT' : input.type, qtyDelta: delta, note: input.note, actorUserId: actor.userId } } : undefined,
        },
      });

      const before = current.stockQty - current.reservedQty;
      const after = row.stockQty - row.reservedQty;
      if (before > row.lowStockThreshold && after <= row.lowStockThreshold) {
        await this.events.publish(tx, { type: 'inventory.low_stock', data: { storeId, productId, name: product.name, available: after, threshold: row.lowStockThreshold }, actor: { type: 'SYSTEM' } });
      }
      await this.events.publish(tx, { type: 'catalog.updated', data: { storeId, productIds: [productId] }, actor: { type: 'PARTNER', userId: actor.userId }, correlationId: actor.correlationId });
      return row;
    });

    const p = await this.prisma.product.findUniqueOrThrow({ where: { id: productId }, include: PRODUCT_INCLUDE });
    return { product: toProductView(p), stockQty: updated.stockQty };
  }

  async movements(storeId: string, productId: string) {
    const product = await this.prisma.product.findFirst({ where: { id: productId, storeId }, include: { inventory: true } });
    if (!product) throw new ApiError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Item not found');
    if (!product.inventory) return [];
    const rows = await this.prisma.inventoryMovement.findMany({ where: { inventoryId: product.inventory.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    const users = await this.prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.actorUserId).filter(Boolean) as string[])] } }, select: { id: true, fullName: true, phone: true } });
    const name = new Map(users.map((u) => [u.id, u.fullName ?? u.phone]));
    return rows.map((r) => ({ id: r.id, type: r.type, qtyDelta: r.qtyDelta, note: r.note, orderId: r.orderId, by: r.actorUserId ? (name.get(r.actorUserId) ?? null) : 'System', at: r.createdAt }));
  }
}
