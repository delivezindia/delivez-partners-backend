import { HttpStatus, Injectable } from '@nestjs/common';
import type { OrderStatus, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';

/** Handed over or collected: counts as a sale for the store. */
export const SOLD: OrderStatus[] = ['PICKED_UP', 'OUT_FOR_DELIVERY', 'ARRIVED', 'DELIVERED', 'COMPLETED'];
const CANCELLED: OrderStatus[] = ['CANCELLED', 'DELIVERY_FAILED', 'REFUNDED'];
const IST_MS = 5.5 * 3600_000;

/** Midnight IST, `daysBack` days before today. */
export const istDayStart = (daysBack = 0, now = Date.now()) => {
  const ist = new Date(now + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() - daysBack) - IST_MS);
};
/** "2026-10-23" for a moment, in IST. */
export const istDate = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
const istTime = (d: Date | null) => (d ? new Date(d.getTime() + IST_MS).toISOString().slice(0, 16).replace('T', ' ') : '');

/** Owner / manager / accountant reports for one store: summary numbers and a CSV of orders. */
@Injectable()
export class OrderReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Live servers leave out simulator test orders; development shows them so the numbers aren't empty. */
  private realOnly(): Prisma.OrderWhereInput {
    return process.env.NODE_ENV === 'production' ? { isTestOrder: false } : {};
  }

  async summary(storeId: string, days: 1 | 7 | 30) {
    const from = istDayStart(days - 1);
    const where: Prisma.OrderWhereInput = { storeId, placedAt: { gte: from }, status: { notIn: ['DRAFT', 'AWAITING_RX_REVIEW'] }, ...this.realOnly() };
    const [orders, missed, top] = await Promise.all([
      this.prisma.order.findMany({ where, select: { status: true, grandTotal: true, placedAt: true, acceptedAt: true, readyAt: true } }),
      this.prisma.orderStatusEvent.count({ where: { toState: 'REJECTED', actorType: 'SYSTEM', order: where } }),
      this.prisma.orderItem.groupBy({
        by: ['productName'],
        where: { isOutOfStock: false, order: { ...where, status: { in: SOLD } } },
        _sum: { qty: true, lineTotal: true },
        orderBy: { _sum: { qty: 'desc' } },
        take: 5,
      }),
    ]);

    const sold = orders.filter((o) => SOLD.includes(o.status));
    const revenue = sold.reduce((n, o) => n + o.grandTotal, 0);
    const prep = sold.filter((o) => o.acceptedAt && o.readyAt).map((o) => (o.readyAt!.getTime() - o.acceptedAt!.getTime()) / 60_000);
    const byDay = Array.from({ length: days }, (_, i) => {
      const day = istDate(istDayStart(days - 1 - i));
      const list = orders.filter((o) => o.placedAt && istDate(o.placedAt) === day);
      const s = list.filter((o) => SOLD.includes(o.status));
      return { date: day, orders: list.length, sold: s.length, revenue: s.reduce((n, o) => n + o.grandTotal, 0) };
    });

    return {
      range: { days, from: istDate(from), to: istDate(new Date()) },
      orders: {
        total: orders.length,
        sold: sold.length,
        active: orders.filter((o) => ['PLACED', 'ACCEPTED', 'PREPARING', 'READY_SOON', 'READY'].includes(o.status)).length,
        rejected: orders.filter((o) => o.status === 'REJECTED').length - missed,
        missed,
        cancelled: orders.filter((o) => CANCELLED.includes(o.status)).length,
      },
      revenue,
      averageOrderValue: sold.length ? Math.round(revenue / sold.length) : 0,
      averagePrepMinutes: prep.length ? Math.round((prep.reduce((a, b) => a + b, 0) / prep.length) * 10) / 10 : null,
      topItems: top.map((t) => ({ name: t.productName, qty: t._sum.qty ?? 0, revenue: t._sum.lineTotal ?? 0 })),
      byDay,
    };
  }

  /** Orders placed between two IST dates (inclusive) as CSV — opens directly in Excel / Google Sheets. */
  async csv(storeId: string, fromDate: string, toDate: string) {
    const from = new Date(`${fromDate}T00:00:00+05:30`);
    const to = new Date(new Date(`${toDate}T00:00:00+05:30`).getTime() + 86_400_000);
    if (!(from < to)) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', '"From" must be on or before "To"');
    if (to.getTime() - from.getTime() > 92 * 86_400_000) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Choose at most 92 days at a time');

    const rows = await this.prisma.order.findMany({
      where: { storeId, placedAt: { gte: from, lt: to }, status: { notIn: ['DRAFT', 'AWAITING_RX_REVIEW'] }, ...this.realOnly() },
      orderBy: { placedAt: 'asc' },
      take: 20_000,
      include: { items: { select: { productName: true, variantName: true, qty: true, isOutOfStock: true } }, customer: { select: { user: { select: { fullName: true } } } } },
    });

    const rs = (p: number) => (p / 100).toFixed(2);
    const cell = (v: unknown) => {
      const s = v == null ? '' : String(v);
      return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
    };
    const header = ['Order', 'Placed (IST)', 'Status', 'Type', 'Customer', 'Items', 'Items total (Rs)', 'Delivery (Rs)', 'Packaging (Rs)', 'Discount (Rs)', 'Total (Rs)', 'Payment', 'Payment status', 'Accepted', 'Ready', 'Handed over / collected', 'Delivered', 'Reason', 'Test order'];
    const lines = rows.map((o) =>
      [
        o.orderNumber,
        istTime(o.placedAt),
        o.status,
        o.fulfilmentType,
        o.customer.user.fullName?.split(/\s+/)[0] ?? '',
        o.items.filter((i) => !i.isOutOfStock).map((i) => `${i.qty} x ${i.productName}${i.variantName ? ` (${i.variantName})` : ''}`).join('; '),
        rs(o.itemsSubtotal),
        rs(o.deliveryFee),
        rs(o.packagingFee),
        rs(o.discountAmount),
        rs(o.grandTotal),
        o.paymentMode,
        o.paymentStatus,
        istTime(o.acceptedAt),
        istTime(o.readyAt),
        istTime(o.pickedUpAt ?? o.completedAt),
        istTime(o.deliveredAt),
        o.rejectReason ?? o.cancelReason ?? '',
        o.isTestOrder ? 'yes' : '',
      ]
        .map(cell)
        .join(','),
    );
    // BOM so Excel opens UTF-8 correctly (names in Kannada, Hindi…).
    return { filename: `delivez-orders-${fromDate}-to-${toDate}.csv`, body: '﻿' + [header.join(','), ...lines].join('\r\n') + '\r\n', count: rows.length };
  }
}
