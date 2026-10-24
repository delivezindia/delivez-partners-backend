import { HttpStatus, Injectable } from '@nestjs/common';
import type { OrderStatus, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { gstBill, isGstin } from './gst';

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

const rs = (p: number) => (p / 100).toFixed(2);
/** CSV cell: quotes when needed, and defuses spreadsheet formulas (=, +, -, @). */
const cell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};
// BOM so Excel opens UTF-8 correctly (names in Kannada, Hindi…).
const csvBody = (rows: unknown[][]) => '\uFEFF' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

/** Owner / manager / accountant reports for one store: summary numbers, a CSV of orders, bills and GST. */
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

  // ------------------------------------------------------------------
  // Bills & GST
  // ------------------------------------------------------------------

  /** The shop's GST registration: the account GSTIN, else a verified GSTIN document. */
  private async taxIdentity(storeId: string) {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: { partnerAccount: { select: { legalName: true, gstin: true } }, city: { select: { name: true, state: true } }, documents: { where: { status: 'VERIFIED', type: { in: ['GSTIN', 'FSSAI', 'DRUG_LICENSE_DL20', 'DRUG_LICENSE_DL21'] } }, select: { type: true, documentNumber: true } } },
    });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    const doc = (t: string) => store.documents.find((d) => d.type === t)?.documentNumber?.trim() || null;
    const gstin = (store.partnerAccount.gstin ?? doc('GSTIN'))?.trim().toUpperCase() || null;
    return {
      store,
      gstin: isGstin(gstin) ? gstin : null,
      fssai: store.vertical === 'EAT' ? doc('FSSAI') : null,
      drugLicences: store.vertical === 'PHARMACY' ? [doc('DRUG_LICENSE_DL20'), doc('DRUG_LICENSE_DL21')].filter((x): x is string => !!x) : [],
    };
  }

  /** Customer bill for one order: a tax invoice when the shop has a GSTIN, otherwise a bill of supply. */
  async invoice(storeId: string, orderId: string) {
    const o = await this.prisma.order.findFirst({
      where: { id: orderId, storeId },
      include: { items: { where: { isOutOfStock: false }, include: { product: { select: { hsnCode: true } } } }, customer: { select: { user: { select: { fullName: true } } } } },
    });
    if (!o || ['DRAFT', 'AWAITING_RX_REVIEW'].includes(o.status)) throw new ApiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    const id = await this.taxIdentity(storeId);
    const s = id.store;
    const bill = gstBill(
      o.items.map((i) => ({ name: `${i.productName}${i.variantName ? ` (${i.variantName})` : ''}`, hsn: i.product.hsnCode, qty: i.qty, ratePct: i.taxRatePct, total: i.lineTotal })),
      o.packagingFee,
      !!id.gstin,
    );
    return {
      kind: id.gstin ? 'TAX_INVOICE' : 'BILL_OF_SUPPLY',
      number: o.orderNumber,
      date: o.placedAt ?? o.createdAt,
      store: {
        name: s.name,
        legalName: s.partnerAccount.legalName,
        address: [s.addressLine1, s.addressLine2, s.landmark, s.city?.name, s.pincode].filter(Boolean).join(', '),
        state: s.city?.state ?? null,
        phone: s.phone,
        gstin: id.gstin,
        fssai: id.fssai,
        drugLicences: id.drugLicences,
      },
      customer: o.customer.user.fullName?.split(/\s+/)[0] ?? 'Customer',
      fulfilmentType: o.fulfilmentType,
      payment: o.paymentMode === 'COD' ? 'Cash' : 'Paid online',
      status: o.status,
      bill,
      delivery: o.deliveryFee,
      discount: o.discountAmount,
      grandTotal: o.grandTotal,
    };
  }

  /** Month of sales split by GST rate, one row per bill and rate, then totals — for the accountant / GSTR-1. */
  async gstCsv(storeId: string, month: string) {
    const from = new Date(`${month}-01T00:00:00+05:30`);
    if (Number.isNaN(from.getTime())) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Use YYYY-MM');
    const [y, m] = month.split('-').map(Number);
    const to = new Date(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01T00:00:00+05:30`);
    const id = await this.taxIdentity(storeId);
    const orders = await this.prisma.order.findMany({
      where: { storeId, placedAt: { gte: from, lt: to }, status: { in: SOLD }, ...this.realOnly() },
      orderBy: { placedAt: 'asc' },
      take: 50_000,
      include: { items: { where: { isOutOfStock: false }, include: { product: { select: { hsnCode: true } } } } },
    });
    const rows: unknown[][] = [
      [id.gstin ? `GST sales report — ${id.store.partnerAccount.legalName} — GSTIN ${id.gstin} — ${month}` : `Sales report — ${id.store.partnerAccount.legalName} — not registered under GST (bills of supply) — ${month}`],
      ['Prices include GST; tax is worked back from each line. Packaging is taxed at the highest item rate on the bill. Delivery is charged by Delivez and is not included.'],
      [],
      ['Invoice', 'Date (IST)', 'GST rate %', 'Taxable value (Rs)', 'CGST (Rs)', 'SGST (Rs)', 'Invoice value at this rate (Rs)'],
    ];
    const totals = new Map<number, { taxable: number; cgst: number; sgst: number; total: number; bills: Set<string> }>();
    for (const o of orders) {
      const b = gstBill(o.items.map((i) => ({ name: i.productName, hsn: i.product.hsnCode, qty: i.qty, ratePct: i.taxRatePct, total: i.lineTotal })), o.packagingFee, !!id.gstin);
      for (const r of b.byRate) {
        rows.push([o.orderNumber, istTime(o.placedAt), r.ratePct, rs(r.taxable), rs(r.cgst), rs(r.sgst), rs(r.total)]);
        const t = totals.get(r.ratePct) ?? { taxable: 0, cgst: 0, sgst: 0, total: 0, bills: new Set<string>() };
        t.taxable += r.taxable;
        t.cgst += r.cgst;
        t.sgst += r.sgst;
        t.total += r.total;
        t.bills.add(o.orderNumber);
        totals.set(r.ratePct, t);
      }
    }
    rows.push([], ['Summary by rate', 'Bills', 'GST rate %', 'Taxable value (Rs)', 'CGST (Rs)', 'SGST (Rs)', 'Total (Rs)']);
    const all = { taxable: 0, cgst: 0, sgst: 0, total: 0 };
    for (const [rate, t] of [...totals.entries()].sort((a, b) => a[0] - b[0])) {
      rows.push(['', t.bills.size, rate, rs(t.taxable), rs(t.cgst), rs(t.sgst), rs(t.total)]);
      all.taxable += t.taxable;
      all.cgst += t.cgst;
      all.sgst += t.sgst;
      all.total += t.total;
    }
    rows.push(['Total', orders.length, '', rs(all.taxable), rs(all.cgst), rs(all.sgst), rs(all.total)]);
    return { filename: `delivez-gst-${month}.csv`, body: csvBody(rows), count: orders.length };
  }
}
