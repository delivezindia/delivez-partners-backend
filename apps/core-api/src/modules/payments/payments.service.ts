import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PaymentMode, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { OrdersService, PAYMENT_WINDOW_MINUTES } from '../orders/orders.service';
import { RazorpayClient, RazorpayError, type RzpPayment } from './razorpay.client';

const TICK_MS = 30_000;
const METHOD: Record<string, PaymentMode> = { upi: 'UPI', card: 'CARD', netbanking: 'NETBANKING', wallet: 'WALLET' };
const PREFER: Partial<Record<PaymentMode, string>> = { UPI: 'upi', CARD: 'card', NETBANKING: 'netbanking' };

export interface CheckoutParams {
  gateway: 'RAZORPAY';
  keyId: string;
  orderId: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  prefill: { name?: string; contact?: string; email?: string; method?: string };
  /** Unpaid orders are released after this. */
  payBy: string;
  testMode: boolean;
}

/**
 * Online payments for customer-app orders (Razorpay):
 * order placed as DRAFT → Razorpay order → Checkout in the app → signature + payment checked here → order PLACED.
 * Also: releases unpaid drafts, sends refunds to Razorpay, and handles the (optional) webhook.
 */
@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  /** Payments that aren't for an order (lab bookings) — handlers registered by their owners. */
  private otherPayment: ((p: RzpPayment) => Promise<boolean>)[] = [];
  private otherRefund: ((providerRefundId: string, status: 'PROCESSED' | 'FAILED') => Promise<boolean>)[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly orders: OrdersService,
    readonly rzp: RazorpayClient,
  ) {}

  get enabled() {
    return this.rzp.enabled;
  }

  onOtherPayment(fn: (p: RzpPayment) => Promise<boolean>) {
    this.otherPayment.push(fn);
  }
  onOtherRefund(fn: (providerRefundId: string, status: 'PROCESSED' | 'FAILED') => Promise<boolean>) {
    this.otherRefund.push(fn);
  }

  onModuleInit() {
    if (this.rzp.enabled) this.logger.log(`Razorpay on (${this.rzp.testMode ? 'TEST' : 'LIVE'} keys)`);
    if (process.env.DISABLE_SCHEDULERS !== 'true') this.timer = setInterval(() => void this.tick(), TICK_MS);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  /** Checkout parameters for an unpaid order — creates the Razorpay order once and reuses it for retries. */
  async checkout(orderId: string): Promise<CheckoutParams> {
    const o = await this.prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { store: { select: { name: true } }, customer: { include: { user: { select: { fullName: true, phone: true, email: true } } } }, payments: { where: { provider: 'RAZORPAY' }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (o.status !== 'DRAFT') throw new ApiError(HttpStatus.CONFLICT, 'ALREADY_PAID', 'This order is already paid or closed');
    const pay = o.payments[0];
    if (!pay) throw new ApiError(HttpStatus.CONFLICT, 'PAYMENT_MISSING', 'Payment record missing — place the order again');
    let rzpOrderId = pay.providerOrderId;
    if (!rzpOrderId) {
      const r = await this.rzp.createOrder(o.grandTotal, o.orderNumber, { orderId: o.id, orderNumber: o.orderNumber, store: o.store.name.slice(0, 200) }).catch((e: Error) => {
        throw new ApiError(HttpStatus.BAD_GATEWAY, 'PAYMENT_GATEWAY_ERROR', `Payment couldn’t be started: ${e.message}`);
      });
      rzpOrderId = r.id;
      await this.prisma.payment.update({ where: { id: pay.id }, data: { providerOrderId: r.id } });
    }
    const u = o.customer.user;
    return {
      gateway: 'RAZORPAY',
      keyId: this.rzp.keyId,
      orderId: rzpOrderId,
      amount: o.grandTotal,
      currency: 'INR',
      name: 'Delivez',
      description: `Order ${o.orderNumber} · ${o.store.name}`,
      prefill: { name: u.fullName ?? undefined, contact: u.phone, email: u.email ?? undefined, method: PREFER[o.paymentMode] },
      payBy: new Date(o.createdAt.getTime() + PAYMENT_WINDOW_MINUTES * 60_000).toISOString(),
      testMode: this.rzp.testMode,
    };
  }

  /** The app's Checkout handler result: check the signature, then ask Razorpay what really happened. */
  async verify(orderId: string, b: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    const pay = await this.prisma.payment.findFirst({ where: { orderId, provider: 'RAZORPAY' }, orderBy: { createdAt: 'desc' } });
    if (!pay?.providerOrderId || pay.providerOrderId !== b.razorpay_order_id) throw new ApiError(HttpStatus.BAD_REQUEST, 'PAYMENT_MISMATCH', 'This payment doesn’t belong to this order');
    if (!this.rzp.checkoutSignatureOk(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) throw new ApiError(HttpStatus.BAD_REQUEST, 'PAYMENT_SIGNATURE_INVALID', 'Payment could not be verified');
    const p = await this.rzp.getPayment(b.razorpay_payment_id);
    if (p.order_id !== pay.providerOrderId) throw new ApiError(HttpStatus.BAD_REQUEST, 'PAYMENT_MISMATCH', 'This payment doesn’t belong to this order');
    const ok = await this.settle(orderId, p);
    if (!ok) throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'PAYMENT_NOT_COMPLETED', p.error_description || 'The payment didn’t go through — try again');
    return { paid: true };
  }

  /** Captures an authorized payment if needed and places the order. False when the payment isn't good. */
  private async settle(orderId: string, p: RzpPayment) {
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId }, select: { grandTotal: true, status: true } });
    if (p.amount !== order.grandTotal || p.currency !== 'INR') {
      this.logger.error(`Amount mismatch on ${orderId}: paid ${p.amount} ${p.currency}, order ${order.grandTotal}`);
      return false;
    }
    let pay = p;
    if (pay.status === 'authorized') pay = await this.rzp.capture(pay.id, pay.amount);
    if (pay.status !== 'captured') return false;
    if (order.status !== 'DRAFT') return true;
    await this.orders.confirmPayment(orderId, { providerPaymentId: pay.id, method: METHOD[pay.method], raw: { id: pay.id, method: pay.method, status: pay.status, order_id: pay.order_id } as Prisma.InputJsonValue });
    return true;
  }

  /** Did a payment land that we never heard about (app closed mid-payment)? */
  async reconcile(orderId: string) {
    const pay = await this.prisma.payment.findFirst({ where: { orderId, provider: 'RAZORPAY', providerOrderId: { not: null } }, orderBy: { createdAt: 'desc' } });
    if (!pay?.providerOrderId) return false;
    const { items } = await this.rzp.orderPayments(pay.providerOrderId);
    const good = items.find((x) => x.status === 'captured') ?? items.find((x) => x.status === 'authorized');
    return good ? this.settle(orderId, good) : false;
  }

  /** Customer gave up before paying. */
  async abandon(orderId: string, userId: string) {
    if (await this.reconcile(orderId).catch(() => false)) throw new ApiError(HttpStatus.CONFLICT, 'ALREADY_PAID', 'This order was just paid — it’s on its way to the shop');
    return this.orders.releaseDraft(orderId, 'Payment not completed', { kind: 'CUSTOMER', userId });
  }

  // ------------------------------------------------------------------ webhook
  async webhook(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody || !signature || !this.rzp.webhookSignatureOk(rawBody, signature)) throw new ApiError(HttpStatus.BAD_REQUEST, 'WEBHOOK_SIGNATURE_INVALID', 'Bad signature');
    const evt = JSON.parse(rawBody.toString('utf8')) as { event: string; payload: { payment?: { entity: RzpPayment }; refund?: { entity: { id: string; status: string } } } };
    const p = evt.payload.payment?.entity;
    if ((evt.event === 'payment.captured' || evt.event === 'payment.authorized' || evt.event === 'order.paid') && p) {
      const pay = await this.prisma.payment.findFirst({ where: { provider: 'RAZORPAY', providerOrderId: p.order_id } });
      if (pay) await this.settle(pay.orderId, p);
      else for (const fn of this.otherPayment) if (await fn(p)) break;
    }
    const r = evt.payload.refund?.entity;
    if ((evt.event === 'refund.processed' || evt.event === 'refund.failed') && r) await this.markRefund(r.id, r.status === 'processed' ? 'PROCESSED' : 'FAILED');
    return { ok: true };
  }

  // ------------------------------------------------------------------ jobs
  async tick(now = new Date()) {
    if (this.running || !this.rzp.enabled) return;
    this.running = true;
    try {
      await this.expireDrafts(now);
      await this.processRefunds();
    } catch (e) {
      this.logger.error(`Payments tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Unpaid drafts past the window: last check with Razorpay, then release the stock. */
  async expireDrafts(now = new Date()) {
    const due = await this.prisma.order.findMany({ where: { status: 'DRAFT', createdAt: { lt: new Date(now.getTime() - PAYMENT_WINDOW_MINUTES * 60_000) } }, select: { id: true }, take: 50 });
    for (const o of due) {
      const paid = await this.reconcile(o.id).catch(() => false);
      if (!paid) await this.orders.releaseDraft(o.id, 'Payment not completed in time', { kind: 'SYSTEM' });
    }
  }

  /** Refunds the order flow created (cancel / reject / item unavailable) → Razorpay; pending ones are polled. */
  async processRefunds() {
    const rows = await this.prisma.refund.findMany({
      where: { status: 'INITIATED', payment: { provider: 'RAZORPAY', providerPaymentId: { not: null } } },
      include: { payment: true },
      take: 20,
      orderBy: { createdAt: 'asc' },
    });
    for (const r of rows) {
      const pid = r.payment!.providerPaymentId!;
      try {
        if (!r.providerRefundId) {
          const out = await this.rzp.refund(pid, r.amount, { orderId: r.orderId, reason: r.reason.slice(0, 200) });
          await this.prisma.refund.update({ where: { id: r.id }, data: { providerRefundId: out.id } });
          if (out.status !== 'pending') await this.markRefund(out.id, out.status === 'processed' ? 'PROCESSED' : 'FAILED');
        } else {
          const out = await this.rzp.getRefund(pid, r.providerRefundId);
          if (out.status !== 'pending') await this.markRefund(out.id, out.status === 'processed' ? 'PROCESSED' : 'FAILED');
        }
      } catch (e) {
        // Razorpay said no (4xx) — stop retrying; ops sees it as a failed refund. Network/5xx: try again next tick.
        if (e instanceof RazorpayError && e.status >= 400 && e.status < 500) {
          await this.prisma.refund.update({ where: { id: r.id }, data: { status: 'FAILED', processedAt: new Date() } });
          this.logger.error(`Refund ${r.id} rejected by Razorpay: ${e.message}`);
        }
      }
    }
  }

  private async markRefund(providerRefundId: string, status: 'PROCESSED' | 'FAILED') {
    const r = await this.prisma.refund.findFirst({ where: { providerRefundId } });
    if (!r) {
      for (const fn of this.otherRefund) if (await fn(providerRefundId, status)) break;
      return;
    }
    if (r.status !== 'INITIATED') return;
    await this.prisma.refund.update({ where: { id: r.id }, data: { status, processedAt: new Date() } });
    if (status !== 'PROCESSED') return;
    const open = await this.prisma.refund.count({ where: { orderId: r.orderId, status: 'INITIATED' } });
    if (!open) await this.prisma.order.updateMany({ where: { id: r.orderId, paymentStatus: 'REFUND_PENDING' }, data: { paymentStatus: 'REFUNDED' } });
  }
}
