import { HttpStatus, Injectable } from '@nestjs/common';
import type { Coupon, Prisma, Vertical } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { AdminContext } from '../admin/admin.guard';
import { checkCoupon, couponHeadline, NOT_COUNTED, PROBLEM_TEXT, type CouponCheck, type CouponKind } from './coupon-rules';

type Db = PrismaService | Prisma.TransactionClient;

/** The order the coupon is being tried on. */
export interface CouponContext {
  customerId: string;
  storeId: string;
  vertical: Vertical;
  cityId: string | null;
  items: number;
  delivery: number;
}

export interface CouponInput {
  code: string;
  description?: string | null;
  discountType: CouponKind;
  discountValue: number;
  maxDiscount?: number | null;
  minOrder: number;
  vertical?: Vertical | null;
  storeId?: string | null;
  cityId?: string | null;
  usageLimit?: number | null;
  perUserLimit: number;
  firstOrderOnly: boolean;
  isPublic: boolean;
  startsAt: Date;
  endsAt: Date;
  isActive?: boolean;
}

/** Once a customer has used a coupon, what it is can't change — only how long it runs and who sees it. */
const LOCKED_AFTER_USE = ['code', 'discountType', 'discountValue', 'maxDiscount'] as const;
const counted = { order: { status: { notIn: [...NOT_COUNTED] } } } satisfies Prisma.CouponRedemptionWhereInput;
const PUBLIC_TTL_MS = 60_000;

export const normCode = (code: string) => code.trim().toUpperCase();

/**
 * Coupons (admin panel → Coupons). Delivez pays for them: the shop is paid for the full items, the customer pays less.
 * A coupon is used up only by orders that go ahead — a dropped unpaid draft or a cancelled order frees it again.
 */
@Injectable()
export class CouponsService {
  private publicCache?: { at: number; value: Awaited<ReturnType<CouponsService['loadPublic']>> };

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // --- Customer side ---------------------------------------------------

  /** Cart preview: does the code fit, and what does it take off? Nothing is reserved. */
  async preview(code: string, ctx: CouponContext) {
    const c = await this.prisma.coupon.findUnique({ where: { code: normCode(code) } });
    if (!c) return { coupon: null, check: { ok: false, problem: 'NOT_FOUND' } as const };
    return { coupon: c, check: await this.check(this.prisma, c, ctx) };
  }

  /**
   * At order time, inside the order's transaction: lock the coupon so two orders can't take its last use,
   * check again, and return the discount. The caller writes the redemption once the order exists.
   */
  async claim(tx: Prisma.TransactionClient, code: string, ctx: CouponContext) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM coupons WHERE code = ${normCode(code)} FOR UPDATE`;
    if (!rows.length) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'COUPON_NOT_FOUND', 'This code doesn’t exist — check the spelling');
    const c = await tx.coupon.findUniqueOrThrow({ where: { id: rows[0].id } });
    const r = await this.check(tx, c, ctx);
    if (!r.ok) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, `COUPON_${r.problem}`, PROBLEM_TEXT[r.problem], r.short ? { short: r.short } : undefined);
    return { couponId: c.id, code: c.code, ...r };
  }

  /** Listed offers that could apply at this shop, each checked against the basket (the cart's "Offers" list). */
  async forBasket(ctx: CouponContext) {
    const now = new Date();
    const list = await this.prisma.coupon.findMany({
      where: {
        isActive: true,
        isPublic: true,
        startsAt: { lte: now },
        endsAt: { gt: now },
        AND: [{ OR: [{ storeId: null }, { storeId: ctx.storeId }] }, { OR: [{ vertical: null }, { vertical: ctx.vertical }] }, { OR: [{ cityId: null }, { cityId: ctx.cityId }] }],
      },
      orderBy: { endsAt: 'asc' },
      take: 20,
    });
    const out = await Promise.all(list.map(async (c) => ({ c, r: await this.check(this.prisma, c, ctx) })));
    // Offers this customer can never use here (used already, first order only…) are left out; "add ₹X more" stays.
    return out
      .filter(({ r }) => r.ok || r.problem === 'BELOW_MINIMUM')
      .map(({ c, r }) => ({ ...this.card(c), ok: r.ok, saved: r.ok ? r.saved : 0, short: !r.ok ? (r.short ?? 0) : 0 }))
      .sort((a, b) => Number(b.ok) - Number(a.ok) || b.saved - a.saved);
  }

  /** Welcome page: the listed offers running now. Cached for a minute. */
  async publicOffers() {
    if (this.publicCache && Date.now() - this.publicCache.at < PUBLIC_TTL_MS) return this.publicCache.value;
    const value = await this.loadPublic();
    this.publicCache = { at: Date.now(), value };
    return value;
  }

  private async loadPublic() {
    const now = new Date();
    const list = await this.prisma.coupon.findMany({
      where: { isActive: true, isPublic: true, startsAt: { lte: now }, endsAt: { gt: now } },
      include: { city: { select: { name: true } } },
      orderBy: { endsAt: 'asc' },
      take: 30,
    });
    const used = await this.usage(list.map((c) => c.id));
    const live = list.filter((c) => c.usageLimit == null || (used.get(c.id)?.count ?? 0) < c.usageLimit).slice(0, 12);
    const shops = await this.storeNames(live.map((c) => c.storeId));
    return live.map((c) => ({ ...this.card(c), city: c.city?.name ?? null, shop: c.storeId ? (shops.get(c.storeId) ?? null) : null }));
  }

  private card(c: Coupon) {
    return {
      code: c.code,
      headline: couponHeadline(c),
      description: c.description,
      kind: c.discountType as CouponKind,
      value: c.discountValue,
      maxDiscount: c.maxDiscount,
      minOrder: c.minOrder,
      vertical: c.vertical,
      firstOrderOnly: c.firstOrderOnly,
      endsAt: c.endsAt,
    };
  }

  private async check(db: Db, c: Coupon, ctx: CouponContext): Promise<CouponCheck> {
    const [usedByAll, usedByMe, myOrders] = await Promise.all([
      c.usageLimit != null ? db.couponRedemption.count({ where: { couponId: c.id, ...counted } }) : 0,
      db.couponRedemption.count({ where: { couponId: c.id, customerId: ctx.customerId, ...counted } }),
      c.firstOrderOnly ? db.order.count({ where: { customerId: ctx.customerId, status: { notIn: [...NOT_COUNTED, 'DRAFT'] } } }) : 0,
    ]);
    return checkCoupon(c, { ...ctx, now: new Date(), usedByAll, usedByMe, myOrders });
  }

  // --- Admin panel -------------------------------------------------------

  async list(status?: 'LIVE' | 'SCHEDULED' | 'ENDED' | 'PAUSED') {
    const rows = await this.prisma.coupon.findMany({ include: { city: { select: { name: true } } }, orderBy: [{ isActive: 'desc' }, { endsAt: 'desc' }], take: 300 });
    const used = await this.usage(rows.map((c) => c.id));
    const shops = await this.storeNames(rows.map((c) => c.storeId));
    const now = new Date();
    return rows
      .map((c) => {
        const u = used.get(c.id) ?? { count: 0, saved: 0 };
        const state = !c.isActive ? 'PAUSED' : c.endsAt <= now || (c.usageLimit != null && u.count >= c.usageLimit) ? 'ENDED' : c.startsAt > now ? 'SCHEDULED' : 'LIVE';
        return { ...c, headline: couponHeadline(c), state, used: u.count, saved: u.saved, city: c.city?.name ?? null, shop: c.storeId ? (shops.get(c.storeId) ?? null) : null };
      })
      .filter((c) => !status || c.state === status);
  }

  async create(input: CouponInput, me: AdminContext, ip?: string) {
    const data = await this.validate({ ...input, code: normCode(input.code) });
    if (await this.prisma.coupon.findUnique({ where: { code: data.code } })) throw new ApiError(HttpStatus.CONFLICT, 'COUPON_CODE_TAKEN', 'A coupon with this code already exists');
    const c = await this.prisma.coupon.create({ data: { ...data, fundedBy: 'PLATFORM', createdById: me.userId } });
    await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'Coupon', entityId: c.id, action: 'CREATE', after: data, ip });
    this.publicCache = undefined;
    return c;
  }

  async update(id: string, patch: Partial<CouponInput>, me: AdminContext, ip?: string) {
    const before = await this.prisma.coupon.findUnique({ where: { id } });
    if (!before) throw new ApiError(HttpStatus.NOT_FOUND, 'COUPON_NOT_FOUND', 'Coupon not found');
    if (patch.code) patch.code = normCode(patch.code);
    const used = await this.prisma.couponRedemption.count({ where: { couponId: id } });
    const locked = LOCKED_AFTER_USE.filter((k) => patch[k] !== undefined && patch[k] !== before[k]);
    if (used && locked.length) throw new ApiError(HttpStatus.CONFLICT, 'COUPON_IN_USE', 'Customers have used this coupon — its code and discount can’t change. Pause it and make a new one.', { fields: locked });
    if (patch.code && patch.code !== before.code && (await this.prisma.coupon.findUnique({ where: { code: patch.code } }))) throw new ApiError(HttpStatus.CONFLICT, 'COUPON_CODE_TAKEN', 'A coupon with this code already exists');
    const merged = await this.validate({ ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as CouponInput);
    const changed = Object.fromEntries(Object.entries(merged).filter(([k, v]) => String(v) !== String(before[k as keyof Coupon])));
    const c = await this.prisma.coupon.update({ where: { id }, data: changed });
    await this.audit.log({ actorUserId: me.userId, actorType: 'ADMIN', entity: 'Coupon', entityId: id, action: 'UPDATE', before: Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof Coupon]])), after: changed, ip });
    this.publicCache = undefined;
    return c;
  }

  /** Who used it: newest first, customers shown by first name and the last digits of their phone. */
  async redemptions(id: string) {
    const rows = await this.prisma.couponRedemption.findMany({
      where: { couponId: id },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        order: { select: { id: true, orderNumber: true, status: true, grandTotal: true, store: { select: { name: true } } } },
        customer: { select: { user: { select: { fullName: true, phone: true } } } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      at: r.createdAt,
      saved: r.amount,
      counted: !(NOT_COUNTED as readonly string[]).includes(r.order.status),
      order: { id: r.order.id, number: r.order.orderNumber, status: r.order.status, paid: r.order.grandTotal, shop: r.order.store.name },
      customer: `${r.customer.user.fullName?.split(' ')[0] || 'Customer'} ··${r.customer.user.phone.slice(-4)}`,
    }));
  }

  /** Shape checks the request schema can't do alone (dates, shop/city exist, value per kind). */
  private async validate(i: CouponInput) {
    const bad = (message: string) => new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'COUPON_INVALID', message);
    if (i.endsAt <= i.startsAt) throw bad('The end date must be after the start date');
    if (i.discountType === 'PERCENT' && (i.discountValue < 1 || i.discountValue > 90)) throw bad('A percentage discount is between 1 and 90');
    if (i.discountType === 'FLAT' && i.discountValue < 100) throw bad('A flat discount is at least ₹1');
    if (i.discountType === 'FLAT' && i.minOrder > 0 && i.discountValue >= i.minOrder) throw bad('A flat discount must be less than the minimum order');
    if (i.storeId && !(await this.prisma.store.findUnique({ where: { id: i.storeId }, select: { id: true } }))) throw bad('That shop doesn’t exist');
    if (i.cityId && !(await this.prisma.city.findUnique({ where: { id: i.cityId }, select: { id: true } }))) throw bad('That city doesn’t exist');
    return {
      code: i.code,
      description: i.description?.trim() || null,
      discountType: i.discountType,
      discountValue: i.discountType === 'FREE_DELIVERY' ? 0 : i.discountValue,
      maxDiscount: i.discountType === 'PERCENT' ? (i.maxDiscount ?? null) : null,
      minOrder: i.minOrder,
      vertical: i.vertical ?? null,
      storeId: i.storeId ?? null,
      cityId: i.cityId ?? null,
      usageLimit: i.usageLimit ?? null,
      perUserLimit: i.perUserLimit,
      firstOrderOnly: i.firstOrderOnly,
      isPublic: i.isPublic,
      startsAt: i.startsAt,
      endsAt: i.endsAt,
      isActive: i.isActive ?? true,
    };
  }

  private async usage(ids: string[]) {
    if (!ids.length) return new Map<string, { count: number; saved: number }>();
    const g = await this.prisma.couponRedemption.groupBy({ by: ['couponId'], where: { couponId: { in: ids }, ...counted }, _count: { _all: true }, _sum: { amount: true } });
    return new Map(g.map((x) => [x.couponId, { count: x._count._all, saved: x._sum.amount ?? 0 }]));
  }

  private async storeNames(ids: (string | null)[]) {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (!want.length) return new Map<string, string>();
    const rows = await this.prisma.store.findMany({ where: { id: { in: want } }, select: { id: true, name: true } });
    return new Map(rows.map((s) => [s.id, s.name]));
  }
}
