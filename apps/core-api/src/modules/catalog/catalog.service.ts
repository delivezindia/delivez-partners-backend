import { HttpStatus, Injectable } from '@nestjs/common';
import { publicApiUrl } from '../../common/public-url';
import type { Prisma, Vertical } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from '../onboarding/onboarding.service';
import type { ProductCreate, ProductUpdate } from './catalog.schemas';

export const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true } },
  variants: { orderBy: { priceDiff: 'asc' } },
  addonGroups: { include: { addons: true } },
  inventory: true,
} satisfies Prisma.ProductInclude;

type ProductRow = Prisma.ProductGetPayload<{ include: typeof PRODUCT_INCLUDE }>;
export type ProductStatus = 'AVAILABLE' | 'HIDDEN' | 'PAUSED' | 'OUT_OF_STOCK';

/**
 * Availability has three layers (plan §5.4.1): the manual switch, a time-boxed pause,
 * and stock (only when tracked). Customers see an item only when all three pass.
 */
export function productStatus(p: Pick<ProductRow, 'isAvailable' | 'pausedUntil' | 'inventory'>, now = new Date()): ProductStatus {
  if (!p.isAvailable) return 'HIDDEN';
  if (p.pausedUntil && p.pausedUntil > now) return 'PAUSED';
  if (p.inventory?.trackStock && p.inventory.stockQty - p.inventory.reservedQty <= 0) return 'OUT_OF_STOCK';
  return 'AVAILABLE';
}

/** Product images live under stores/{id}/products/ and are served by the public file route. */
export const imageUrl = (key: string) => (key.startsWith('http') ? key : publicApiUrl(`/v1/files/public/${key}`));

export function toProductView(p: ProductRow) {
  const inv = p.inventory;
  const available = inv ? inv.stockQty - inv.reservedQty : null;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    images: p.images.map((key) => ({ key, url: imageUrl(key) })),
    sku: p.sku,
    barcode: p.barcode,
    unit: p.unit,
    unitSize: p.unitSize,
    price: p.price,
    mrp: p.mrp,
    taxRatePct: p.taxRatePct,
    hsnCode: p.hsnCode,
    isAvailable: p.isAvailable,
    pausedUntil: p.pausedUntil && p.pausedUntil > new Date() ? p.pausedUntil : null,
    isComplex: p.isComplex,
    prepMinutes: p.prepMinutes,
    maxQtyPerOrder: p.maxQtyPerOrder,
    sortOrder: p.sortOrder,
    isVeg: p.isVeg,
    spiceLevel: p.spiceLevel,
    prescriptionRequired: p.prescriptionRequired,
    drugSchedule: p.drugSchedule,
    saltComposition: p.saltComposition,
    manufacturer: p.manufacturer,
    substitutionAllowed: p.substitutionAllowed,
    lab:
      p.labSampleType != null || p.labReportHours != null
        ? {
            sampleType: p.labSampleType,
            fastingHours: p.labFastingHours,
            reportHours: p.labReportHours,
            homeCollection: p.labHomeCollection,
            walkIn: p.labWalkIn,
            parameters: p.labParameters,
            preparation: p.labPreparation,
          }
        : null,
    tags: p.tags,
    variants: p.variants.map((v) => ({ id: v.id, name: v.name, priceDiff: v.priceDiff, isDefault: v.isDefault })),
    addonGroups: p.addonGroups.map((g) => ({ id: g.id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, addons: g.addons.map((a) => ({ id: a.id, name: a.name, price: a.price, isVeg: a.isVeg })) })),
    inventory: inv
      ? {
          trackStock: inv.trackStock,
          stockQty: inv.stockQty,
          reservedQty: inv.reservedQty,
          available,
          lowStockThreshold: inv.lowStockThreshold,
          isLow: inv.trackStock && available! <= inv.lowStockThreshold,
          batchNo: inv.batchNo,
          expiryDate: inv.expiryDate,
        }
      : null,
    status: productStatus(p),
    updatedAt: p.updatedAt,
  };
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  // ------------------------------------------------------------------
  // Categories
  // ------------------------------------------------------------------

  async categories(storeId: string) {
    const [cats, counts, uncategorized] = await Promise.all([
      this.prisma.category.findMany({ where: { storeId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] }),
      this.prisma.product.groupBy({ by: ['categoryId'], where: { storeId, deletedAt: null }, _count: { _all: true } }),
      this.prisma.product.count({ where: { storeId, deletedAt: null, categoryId: null } }),
    ]);
    const count = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    return {
      categories: cats.map((c) => ({ id: c.id, name: c.name, sortOrder: c.sortOrder, isActive: c.isActive, productCount: count.get(c.id) ?? 0 })),
      uncategorized,
    };
  }

  async createCategory(storeId: string, input: { name: string; isActive?: boolean }, actor: Actor) {
    const max = await this.prisma.category.aggregate({ where: { storeId }, _max: { sortOrder: true } });
    try {
      const c = await this.prisma.category.create({ data: { storeId, name: input.name, isActive: input.isActive ?? true, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
      await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Category', entityId: c.id, action: 'CREATE', after: { name: c.name }, ip: actor.ip });
      await this.changed(storeId, actor, { categoryIds: [c.id] });
      return c;
    } catch (err) {
      throw uniqueToConflict(err, 'A category with this name already exists');
    }
  }

  async updateCategory(storeId: string, id: string, input: { name?: string; isActive?: boolean; sortOrder?: number }, actor: Actor) {
    await this.mustOwnCategory(storeId, id);
    try {
      const c = await this.prisma.category.update({ where: { id }, data: input });
      await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Category', entityId: id, action: 'UPDATE', after: input, ip: actor.ip });
      await this.changed(storeId, actor, { categoryIds: [id] });
      return c;
    } catch (err) {
      throw uniqueToConflict(err, 'A category with this name already exists');
    }
  }

  /** Deleting a category keeps its items — they move to "Uncategorised". */
  async deleteCategory(storeId: string, id: string, actor: Actor) {
    await this.mustOwnCategory(storeId, id);
    await this.prisma.$transaction([
      this.prisma.product.updateMany({ where: { storeId, categoryId: id }, data: { categoryId: null } }),
      this.prisma.category.delete({ where: { id } }),
    ]);
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Category', entityId: id, action: 'DELETE', ip: actor.ip });
    await this.changed(storeId, actor, { categoryIds: [id] });
  }

  async reorderCategories(storeId: string, ids: string[], actor: Actor) {
    const owned = await this.prisma.category.count({ where: { storeId, id: { in: ids } } });
    if (owned !== ids.length) throw new ApiError(HttpStatus.BAD_REQUEST, 'CATEGORY_NOT_FOUND', 'Some categories are not in this store');
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.category.update({ where: { id }, data: { sortOrder: i + 1 } })));
    await this.changed(storeId, actor, { categoryIds: ids });
    return this.categories(storeId);
  }

  // ------------------------------------------------------------------
  // Products
  // ------------------------------------------------------------------

  async products(storeId: string, query: { categoryId?: string; q?: string; status?: string }) {
    const rows = await this.prisma.product.findMany({
      where: {
        storeId,
        deletedAt: null,
        categoryId: query.categoryId,
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                { sku: { contains: query.q, mode: 'insensitive' } },
                { barcode: query.q },
                { saltComposition: { contains: query.q, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: PRODUCT_INCLUDE,
      orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
    const views = rows.map(toProductView);
    const filtered = !query.status
      ? views
      : query.status === 'LOW_STOCK'
        ? views.filter((p) => p.inventory?.isLow)
        : views.filter((p) => p.status === query.status);
    const summary = { total: views.length, AVAILABLE: 0, HIDDEN: 0, PAUSED: 0, OUT_OF_STOCK: 0, LOW_STOCK: views.filter((p) => p.inventory?.isLow).length };
    for (const p of views) summary[p.status]++;
    return { products: filtered, summary };
  }

  async product(storeId: string, id: string) {
    return toProductView(await this.load(storeId, id));
  }

  async create(storeId: string, input: ProductCreate, actor: Actor) {
    const store = await this.storeOf(storeId);
    const data = await this.normalise(storeId, store.vertical, input);
    const max = await this.prisma.product.aggregate({ where: { storeId, categoryId: data.categoryId ?? null }, _max: { sortOrder: true } });
    const stock = input.stock ?? (store.vertical === 'GROCERY' || store.vertical === 'PHARMACY' ? { trackStock: true, stockQty: 0 } : undefined);

    const product = await this.prisma.$transaction(async (tx) => {
      const p = await tx.product.create({
        data: {
          ...data.fields,
          storeId,
          categoryId: data.categoryId ?? null,
          sortOrder: (max._max.sortOrder ?? 0) + 1,
          variants: input.variants?.length ? { create: input.variants.map(({ name, priceDiff, isDefault }) => ({ name, priceDiff, isDefault })) } : undefined,
          addonGroups: input.addonGroups?.length
            ? { create: input.addonGroups.map((g) => ({ name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, addons: { create: g.addons.map((a) => ({ name: a.name, price: a.price, isVeg: a.isVeg ?? null })) } })) }
            : undefined,
          inventory: stock
            ? {
                create: {
                  trackStock: stock.trackStock,
                  stockQty: stock.stockQty ?? 0,
                  lowStockThreshold: stock.lowStockThreshold ?? 5,
                  batchNo: stock.batchNo ?? null,
                  expiryDate: stock.expiryDate ? new Date(`${stock.expiryDate}T00:00:00Z`) : null,
                  movements: stock.stockQty ? { create: { type: 'PURCHASE', qtyDelta: stock.stockQty, note: 'Opening stock', actorUserId: actor.userId } } : undefined,
                },
              }
            : undefined,
        },
        include: PRODUCT_INCLUDE,
      });
      await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Product', entityId: p.id, action: 'CREATE', after: { name: p.name, price: p.price }, ip: actor.ip }, tx);
      return p;
    });
    await this.changed(storeId, actor, { productIds: [product.id] });
    return toProductView(product);
  }

  async update(storeId: string, id: string, input: ProductUpdate, actor: Actor) {
    const before = await this.load(storeId, id);
    const store = await this.storeOf(storeId);
    const merged = { ...input, price: input.price ?? before.price, name: input.name ?? before.name };
    const mrp = input.mrp !== undefined ? input.mrp : before.mrp;
    if (mrp != null && mrp < merged.price) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'MRP cannot be lower than the selling price', { fieldErrors: { mrp: ['MRP cannot be lower than the selling price'] } });
    const data = await this.normalise(storeId, store.vertical, merged as ProductCreate, before);

    const product = await this.prisma.$transaction(async (tx) => {
      if (input.variants) {
        await tx.productVariant.deleteMany({ where: { productId: id } });
        if (input.variants.length) await tx.productVariant.createMany({ data: input.variants.map(({ name, priceDiff, isDefault }) => ({ productId: id, name, priceDiff, isDefault })) });
      }
      if (input.addonGroups) {
        await tx.productAddonGroup.deleteMany({ where: { productId: id } });
        for (const g of input.addonGroups) {
          await tx.productAddonGroup.create({ data: { productId: id, name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, addons: { create: g.addons.map((a) => ({ name: a.name, price: a.price, isVeg: a.isVeg ?? null })) } } });
        }
      }
      if (input.stock) await this.applyStockSettings(tx, id, before, input.stock, actor);
      const p = await tx.product.update({
        where: { id },
        data: { ...data.fields, ...(input.categoryId !== undefined ? { categoryId: data.categoryId ?? null } : {}) },
        include: PRODUCT_INCLUDE,
      });
      await this.audit.log(
        { actorUserId: actor.userId, actorType: 'USER', entity: 'Product', entityId: id, action: 'UPDATE', before: { name: before.name, price: before.price, isAvailable: before.isAvailable }, after: { ...data.fields }, ip: actor.ip },
        tx,
      );
      return p;
    });
    await this.changed(storeId, actor, { productIds: [id] });
    return toProductView(product);
  }

  async remove(storeId: string, id: string, actor: Actor) {
    await this.load(storeId, id);
    await this.prisma.product.update({ where: { id }, data: { deletedAt: new Date(), isAvailable: false } });
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Product', entityId: id, action: 'DELETE', ip: actor.ip });
    await this.changed(storeId, actor, { productIds: [id] });
  }

  /** The everyday kitchen/counter action: switch an item on or off. */
  async setAvailability(storeId: string, id: string, isAvailable: boolean, actor: Actor) {
    await this.load(storeId, id);
    const p = await this.prisma.product.update({ where: { id }, data: { isAvailable, pausedUntil: isAvailable ? null : undefined }, include: PRODUCT_INCLUDE });
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Product', entityId: id, action: 'UPDATE', after: { isAvailable }, ip: actor.ip });
    await this.changed(storeId, actor, { productIds: [id] });
    return toProductView(p);
  }

  /** Time-boxed pause (e.g. "out for 1 hour"); null resumes now. */
  async pause(storeId: string, id: string, minutes: number | null, actor: Actor) {
    await this.load(storeId, id);
    const pausedUntil = minutes ? new Date(Date.now() + minutes * 60_000) : null;
    const p = await this.prisma.product.update({ where: { id }, data: { pausedUntil }, include: PRODUCT_INCLUDE });
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Product', entityId: id, action: 'UPDATE', after: { pausedUntil }, ip: actor.ip });
    await this.changed(storeId, actor, { productIds: [id] });
    return toProductView(p);
  }

  async bulk(storeId: string, input: { ids: string[]; action: string; categoryId?: string | null; percent?: number }, actor: Actor) {
    const owned = await this.prisma.product.findMany({ where: { storeId, id: { in: input.ids }, deletedAt: null }, select: { id: true, price: true, mrp: true } });
    if (owned.length !== new Set(input.ids).size) throw new ApiError(HttpStatus.BAD_REQUEST, 'PRODUCT_NOT_FOUND', 'Some items are not in this store');
    const ids = owned.map((p) => p.id);

    switch (input.action) {
      case 'MAKE_AVAILABLE':
        await this.prisma.product.updateMany({ where: { id: { in: ids } }, data: { isAvailable: true, pausedUntil: null } });
        break;
      case 'MAKE_UNAVAILABLE':
        await this.prisma.product.updateMany({ where: { id: { in: ids } }, data: { isAvailable: false } });
        break;
      case 'DELETE':
        await this.prisma.product.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date(), isAvailable: false } });
        break;
      case 'MOVE':
        if (input.categoryId) await this.mustOwnCategory(storeId, input.categoryId);
        await this.prisma.product.updateMany({ where: { id: { in: ids } }, data: { categoryId: input.categoryId ?? null } });
        break;
      case 'PRICE_PERCENT': {
        if (!input.percent) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Enter a percentage');
        // Round to whole rupees; never go above MRP.
        await this.prisma.$transaction(
          owned.map((p) => {
            let price = Math.round((p.price * (1 + input.percent! / 100)) / 100) * 100;
            if (p.mrp != null) price = Math.min(price, p.mrp);
            return this.prisma.product.update({ where: { id: p.id }, data: { price: Math.max(100, price) } });
          }),
        );
        break;
      }
    }
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'Product', entityId: storeId, action: 'UPDATE', after: { bulk: input.action, count: ids.length, categoryId: input.categoryId, percent: input.percent }, ip: actor.ip });
    await this.changed(storeId, actor, { productIds: ids });
    return { updated: ids.length };
  }

  async reorderProducts(storeId: string, ids: string[], actor: Actor) {
    const owned = await this.prisma.product.count({ where: { storeId, id: { in: ids } } });
    if (owned !== ids.length) throw new ApiError(HttpStatus.BAD_REQUEST, 'PRODUCT_NOT_FOUND', 'Some items are not in this store');
    await this.prisma.$transaction(ids.map((id, i) => this.prisma.product.update({ where: { id }, data: { sortOrder: i + 1 } })));
    await this.changed(storeId, actor, { productIds: ids });
    return { reordered: ids.length };
  }

  // ------------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------------

  /** Vertical rules: veg flag for food, Rx rules for pharmacy, Schedule X blocked, images scoped to the store. */
  private async normalise(storeId: string, vertical: Vertical, input: Partial<ProductCreate>, before?: ProductRow) {
    if (input.categoryId) await this.mustOwnCategory(storeId, input.categoryId);
    if (input.images?.some((k) => !k.startsWith(`stores/${storeId}/products/`))) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'IMAGE_INVALID', 'Upload images for this store first');
    }
    if (input.variants && input.variants.filter((v) => v.isDefault).length > 1) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Only one size can be the default', { fieldErrors: { variants: ['Only one default'] } });
    }
    const schedule = input.drugSchedule ?? before?.drugSchedule;
    if (vertical === 'PHARMACY' && schedule === 'X') {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'SCHEDULE_X_BLOCKED', 'Schedule X drugs cannot be sold on Delivez');
    }

    const fields: Prisma.ProductUncheckedUpdateInput = {};
    const copy = [
      'name', 'description', 'images', 'sku', 'barcode', 'unit', 'unitSize', 'price', 'mrp', 'taxRatePct', 'hsnCode',
      'isAvailable', 'isComplex', 'prepMinutes', 'maxQtyPerOrder', 'spiceLevel', 'tags', 'saltComposition', 'manufacturer', 'substitutionAllowed',
    ] as const;
    for (const k of copy) if (input[k] !== undefined) (fields as Record<string, unknown>)[k] = input[k];

    if (vertical === 'EAT') {
      if (input.isVeg !== undefined) fields.isVeg = input.isVeg;
    } else {
      fields.isVeg = null;
      fields.spiceLevel = null;
    }
    if (vertical === 'PHARMACY') {
      if (input.drugSchedule !== undefined) fields.drugSchedule = input.drugSchedule;
      const rx = input.prescriptionRequired ?? before?.prescriptionRequired ?? false;
      fields.prescriptionRequired = rx || schedule === 'H' || schedule === 'H1';
    } else if (vertical === 'DIAGNOSTICS') {
      // Lab tests: the lab decides which tests need a doctor's prescription.
      fields.drugSchedule = 'NONE';
      fields.saltComposition = null;
      if (input.prescriptionRequired !== undefined) fields.prescriptionRequired = input.prescriptionRequired;
      const lab = ['labSampleType', 'labFastingHours', 'labReportHours', 'labHomeCollection', 'labWalkIn', 'labParameters', 'labPreparation'] as const;
      for (const k of lab) if (input[k] !== undefined) (fields as Record<string, unknown>)[k] = input[k];
      const home = input.labHomeCollection ?? before?.labHomeCollection ?? true;
      const walk = input.labWalkIn ?? before?.labWalkIn ?? true;
      if (home === false && walk === false) {
        throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Offer this test by home collection, walk-in or both', { fieldErrors: { labHomeCollection: ['Choose at least one'] } });
      }
    } else {
      fields.drugSchedule = 'NONE';
      fields.prescriptionRequired = false;
      fields.saltComposition = null;
    }
    if (vertical !== 'DIAGNOSTICS') {
      Object.assign(fields, { labSampleType: null, labFastingHours: null, labReportHours: null, labHomeCollection: null, labWalkIn: null, labParameters: null, labPreparation: null });
    }
    return { fields: fields as Prisma.ProductUncheckedCreateInput & Prisma.ProductUncheckedUpdateInput, categoryId: input.categoryId };
  }

  private async applyStockSettings(tx: Prisma.TransactionClient, productId: string, before: ProductRow, s: NonNullable<ProductCreate['stock']>, actor: Actor) {
    const expiryDate = s.expiryDate === undefined ? undefined : s.expiryDate ? new Date(`${s.expiryDate}T00:00:00Z`) : null;
    if (!before.inventory) {
      await tx.inventory.create({
        data: {
          productId,
          trackStock: s.trackStock,
          stockQty: s.stockQty ?? 0,
          lowStockThreshold: s.lowStockThreshold ?? 5,
          batchNo: s.batchNo ?? null,
          expiryDate: expiryDate ?? null,
          movements: s.stockQty ? { create: { type: 'PURCHASE', qtyDelta: s.stockQty, note: 'Opening stock', actorUserId: actor.userId } } : undefined,
        },
      });
      return;
    }
    const delta = s.stockQty !== undefined ? s.stockQty - before.inventory.stockQty : 0;
    await tx.inventory.update({
      where: { id: before.inventory.id },
      data: {
        trackStock: s.trackStock,
        stockQty: s.stockQty,
        lowStockThreshold: s.lowStockThreshold,
        batchNo: s.batchNo,
        expiryDate,
        movements: delta ? { create: { type: 'ADJUSTMENT', qtyDelta: delta, note: 'Edited from item details', actorUserId: actor.userId } } : undefined,
      },
    });
  }

  private async load(storeId: string, id: string): Promise<ProductRow> {
    const p = await this.prisma.product.findFirst({ where: { id, storeId, deletedAt: null }, include: PRODUCT_INCLUDE });
    if (!p) throw new ApiError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Item not found');
    return p;
  }

  private async mustOwnCategory(storeId: string, id: string) {
    const c = await this.prisma.category.findFirst({ where: { id, storeId } });
    if (!c) throw new ApiError(HttpStatus.BAD_REQUEST, 'CATEGORY_NOT_FOUND', 'Category not found in this store');
    return c;
  }

  private storeOf(storeId: string) {
    return this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { vertical: true } });
  }

  /** Realtime + future WhatsApp catalog sync hook (plan §6.7). */
  private async changed(storeId: string, actor: Actor, data: { productIds?: string[]; categoryIds?: string[] }) {
    await this.prisma.$transaction(async (tx) => {
      await this.events.publish(tx, { type: 'catalog.updated', data: { storeId, ...data }, actor: { type: 'PARTNER', userId: actor.userId }, correlationId: actor.correlationId });
    });
  }
}

function uniqueToConflict(err: unknown, message: string) {
  if ((err as { code?: string })?.code === 'P2002') return new ApiError(HttpStatus.CONFLICT, 'DUPLICATE', message);
  return err;
}
