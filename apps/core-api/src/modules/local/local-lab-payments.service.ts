import { HttpStatus, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { LabPayment, PaymentMode, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { PrismaService } from '../../prisma/prisma.service';
import { LabBookingsService, type CreateBookingInput } from '../lab-bookings/lab-bookings.service';
import { PAYMENT_WINDOW_MINUTES } from '../orders/orders.service';
import { PaymentsService, type CheckoutParams } from '../payments/payments.service';
import { RazorpayError, type RzpPayment } from '../payments/razorpay.client';

const TICK_MS = 30_000;
const PREFER: Partial<Record<PaymentMode, string>> = { UPI: 'upi', CARD: 'card', NETBANKING: 'netbanking' };
type Stored = Omit<CreateBookingInput, 'slotStart'> & { slotStart: string };

/**
 * Lab bookings paid online (Razorpay). Pay first, then book: every booking check runs before the payment,
 * the booking is created only once the money is in, so the lab never sees an unpaid booking.
 * If the slot fills up while the customer pays, or a paid booking is cancelled / rejected, the money goes back from here.
 */
@Injectable()
export class LocalLabPaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LocalLabPaymentsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly labs: LabBookingsService,
    private readonly payments: PaymentsService,
  ) {}

  onModuleInit() {
    this.payments.onOtherPayment((p) => this.fromWebhook(p));
    this.payments.onOtherRefund((id, status) => this.markRefund(id, status));
    if (process.env.DISABLE_SCHEDULERS !== 'true') this.timer = setInterval(() => void this.tick(), TICK_MS);
  }
  onModuleDestroy() {
    clearInterval(this.timer);
  }

  get enabled() {
    return this.payments.enabled;
  }

  /** Checks the booking, then opens a Razorpay order for it. */
  async start(userId: string, input: CreateBookingInput): Promise<{ paymentId: string; checkout: CheckoutParams }> {
    if (!this.enabled) throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'PAYMENT_UNAVAILABLE', 'Online payment isn’t available right now — choose pay at collection');
    const { grandTotal } = await this.labs.check(input);
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: input.storeId }, select: { name: true } });
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, phone: true, email: true } });
    const stored: Stored = { ...input, slotStart: input.slotStart.toISOString() };
    const lp = await this.prisma.labPayment.create({ data: { userId, storeId: input.storeId, input: stored as unknown as Prisma.InputJsonValue, amount: grandTotal, method: input.paymentMode } });
    try {
      const r = await this.payments.rzp.createOrder(grandTotal, `LABPAY-${lp.id.slice(0, 8)}`, { labPaymentId: lp.id, store: store.name.slice(0, 200) });
      await this.prisma.labPayment.update({ where: { id: lp.id }, data: { providerOrderId: r.id } });
      return {
        paymentId: lp.id,
        checkout: {
          gateway: 'RAZORPAY',
          keyId: this.payments.rzp.keyId,
          orderId: r.id,
          amount: grandTotal,
          currency: 'INR',
          name: 'Delivez',
          description: `Lab tests · ${store.name}`,
          prefill: { name: user.fullName ?? undefined, contact: user.phone, email: user.email ?? undefined, method: PREFER[input.paymentMode] },
          payBy: new Date(lp.createdAt.getTime() + PAYMENT_WINDOW_MINUTES * 60_000).toISOString(),
          testMode: this.payments.rzp.testMode,
        },
      };
    } catch (e) {
      await this.prisma.labPayment.update({ where: { id: lp.id }, data: { status: 'FAILED', failureReason: 'Payment could not be started' } });
      throw new ApiError(HttpStatus.BAD_GATEWAY, 'PAYMENT_GATEWAY_ERROR', `Payment couldn’t be started: ${(e as Error).message}`);
    }
  }

  /** The app's Checkout result: signature + what Razorpay says → book. Returns the new booking id. */
  async verify(userId: string, paymentId: string, b: { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }) {
    const lp = await this.own(userId, paymentId);
    if (!lp.providerOrderId || lp.providerOrderId !== b.razorpay_order_id) throw new ApiError(HttpStatus.BAD_REQUEST, 'PAYMENT_MISMATCH', 'This payment doesn’t belong to this booking');
    if (!this.payments.rzp.checkoutSignatureOk(b.razorpay_order_id, b.razorpay_payment_id, b.razorpay_signature)) throw new ApiError(HttpStatus.BAD_REQUEST, 'PAYMENT_SIGNATURE_INVALID', 'Payment could not be verified');
    const p = await this.payments.rzp.getPayment(b.razorpay_payment_id);
    if (p.order_id !== lp.providerOrderId) throw new ApiError(HttpStatus.BAD_REQUEST, 'PAYMENT_MISMATCH', 'This payment doesn’t belong to this booking');
    return this.outcome(await this.settle(lp.id, p));
  }

  /** Customer closed Checkout: a last look at Razorpay (paid in another tab?), otherwise the attempt is dropped. */
  async abandon(userId: string, paymentId: string) {
    const lp = await this.own(userId, paymentId);
    const after = await this.reconcile(lp.id).catch(() => null);
    if (after?.status === 'BOOKED' || after?.status === 'REFUND_PENDING') return this.outcome(after);
    await this.prisma.labPayment.updateMany({ where: { id: lp.id, status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'Payment not completed' } });
    return { booked: false as const };
  }

  private outcome(lp: LabPayment) {
    if (lp.status === 'BOOKED' && lp.bookingId) return { booked: true as const, bookingId: lp.bookingId };
    if (lp.status === 'REFUND_PENDING' || lp.status === 'REFUNDED')
      throw new ApiError(HttpStatus.CONFLICT, 'BOOKING_FAILED_REFUNDED', `${lp.failureReason ?? 'The booking couldn’t be made'} — your payment is being refunded`);
    if (lp.status === 'SETTLING') throw new ApiError(HttpStatus.ACCEPTED, 'PAYMENT_PROCESSING', 'Payment received — confirming your booking');
    throw new ApiError(HttpStatus.PAYMENT_REQUIRED, 'PAYMENT_NOT_COMPLETED', lp.failureReason || 'The payment didn’t go through — try again');
  }

  /**
   * Captures the payment and books, exactly once (verify, the webhook and the tick can all arrive).
   * If the booking fails now (slot filled, test paused), the full amount is refunded.
   */
  private async settle(id: string, p: RzpPayment): Promise<LabPayment> {
    const lp = await this.prisma.labPayment.findUniqueOrThrow({ where: { id } });
    if (lp.status !== 'PENDING' && lp.status !== 'FAILED') return lp;
    if (p.amount !== lp.amount || p.currency !== 'INR') {
      this.logger.error(`Amount mismatch on lab payment ${id}: paid ${p.amount} ${p.currency}, expected ${lp.amount}`);
      return lp;
    }
    let pay = p;
    if (pay.status === 'authorized') pay = await this.payments.rzp.capture(pay.id, pay.amount);
    if (pay.status !== 'captured') return lp;
    // Claim it: only one caller gets to book.
    const claimed = await this.prisma.labPayment.updateMany({ where: { id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'SETTLING', providerPaymentId: pay.id } });
    if (!claimed.count) return this.prisma.labPayment.findUniqueOrThrow({ where: { id } });
    const stored = lp.input as unknown as Stored;
    try {
      const booking = await this.labs.create({ ...stored, slotStart: new Date(stored.slotStart), paymentMode: lp.method }, { kind: 'CUSTOMER', userId: lp.userId });
      return this.prisma.labPayment.update({ where: { id }, data: { status: 'BOOKED', bookingId: booking.id } });
    } catch (e) {
      const reason = e instanceof ApiError ? e.message : 'The booking couldn’t be made';
      this.logger.warn(`Lab payment ${id} paid but not booked (${reason}) — refunding`);
      return this.prisma.labPayment.update({ where: { id }, data: { status: 'REFUND_PENDING', refundAmount: lp.amount, failureReason: reason } });
    }
  }

  private async reconcile(id: string) {
    const lp = await this.prisma.labPayment.findUniqueOrThrow({ where: { id } });
    if (!lp.providerOrderId) return lp;
    const { items } = await this.payments.rzp.orderPayments(lp.providerOrderId);
    const good = items.find((x) => x.status === 'captured') ?? items.find((x) => x.status === 'authorized');
    return good ? this.settle(id, good) : lp;
  }

  private async fromWebhook(p: RzpPayment) {
    const lp = await this.prisma.labPayment.findUnique({ where: { providerOrderId: p.order_id } });
    if (lp) await this.settle(lp.id, p);
    return !!lp;
  }

  private async own(userId: string, id: string) {
    const lp = await this.prisma.labPayment.findFirst({ where: { id, userId } });
    if (!lp) throw new ApiError(HttpStatus.NOT_FOUND, 'PAYMENT_NOT_FOUND', 'Payment not found');
    return lp;
  }

  // ------------------------------------------------------------------ jobs
  async tick(now = new Date()) {
    if (this.running || !this.enabled) return;
    this.running = true;
    try {
      await this.expire(now);
      await this.queueBookingRefunds();
      await this.processRefunds();
    } catch (e) {
      this.logger.error(`Lab payments tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /** Unpaid attempts past the window: last check with Razorpay, then drop them (nothing was held). */
  async expire(now = new Date()) {
    const due = await this.prisma.labPayment.findMany({ where: { status: 'PENDING', createdAt: { lt: new Date(now.getTime() - PAYMENT_WINDOW_MINUTES * 60_000) } }, select: { id: true }, take: 50 });
    for (const lp of due) {
      const after = await this.reconcile(lp.id).catch(() => null);
      if (after?.status === 'PENDING') await this.prisma.labPayment.updateMany({ where: { id: lp.id, status: 'PENDING' }, data: { status: 'FAILED', failureReason: 'Payment not completed in time' } });
    }
  }

  /** A paid booking was cancelled or rejected (the booking flow marks it REFUND_PENDING) → refund it from its payment. */
  async queueBookingRefunds() {
    const rows = await this.prisma.labBooking.findMany({ where: { paymentStatus: 'REFUND_PENDING', channel: 'LOCAL_WEB' }, select: { id: true, refundAmount: true, cancelReason: true }, take: 50 });
    for (const b of rows) {
      await this.prisma.labPayment.updateMany({ where: { bookingId: b.id, status: 'BOOKED' }, data: { status: 'REFUND_PENDING', refundAmount: b.refundAmount, failureReason: b.cancelReason ?? 'Booking cancelled' } });
    }
  }

  async processRefunds() {
    const rows = await this.prisma.labPayment.findMany({ where: { status: 'REFUND_PENDING', providerPaymentId: { not: null } }, take: 20, orderBy: { updatedAt: 'asc' } });
    for (const lp of rows) {
      const pid = lp.providerPaymentId!;
      try {
        if (!lp.providerRefundId) {
          const out = await this.payments.rzp.refund(pid, Math.min(lp.refundAmount || lp.amount, lp.amount), { labPaymentId: lp.id, reason: (lp.failureReason ?? 'Lab booking refund').slice(0, 200) });
          await this.prisma.labPayment.update({ where: { id: lp.id }, data: { providerRefundId: out.id } });
          if (out.status !== 'pending') await this.markRefund(out.id, out.status === 'processed' ? 'PROCESSED' : 'FAILED');
        } else {
          const out = await this.payments.rzp.getRefund(pid, lp.providerRefundId);
          if (out.status !== 'pending') await this.markRefund(out.id, out.status === 'processed' ? 'PROCESSED' : 'FAILED');
        }
      } catch (e) {
        // Razorpay said no (4xx) — stop retrying; ops sees it. Network / 5xx: next tick.
        if (e instanceof RazorpayError && e.status >= 400 && e.status < 500) {
          await this.prisma.labPayment.update({ where: { id: lp.id }, data: { status: 'REFUND_FAILED' } });
          this.logger.error(`Lab refund ${lp.id} rejected by Razorpay: ${e.message}`);
        }
      }
    }
  }

  private async markRefund(providerRefundId: string, status: 'PROCESSED' | 'FAILED') {
    const lp = await this.prisma.labPayment.findFirst({ where: { providerRefundId, status: 'REFUND_PENDING' } });
    if (!lp) return false;
    await this.prisma.labPayment.update({ where: { id: lp.id }, data: { status: status === 'PROCESSED' ? 'REFUNDED' : 'REFUND_FAILED' } });
    if (status === 'PROCESSED' && lp.bookingId) await this.prisma.labBooking.updateMany({ where: { id: lp.bookingId, paymentStatus: 'REFUND_PENDING' }, data: { paymentStatus: 'REFUNDED' } });
    return true;
  }
}
