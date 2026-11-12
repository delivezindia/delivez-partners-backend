import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';

const API = 'https://api.razorpay.com/v1';

export interface RzpOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: 'created' | 'attempted' | 'paid';
}
export interface RzpPayment {
  id: string;
  order_id: string;
  amount: number;
  currency: string;
  status: 'created' | 'authorized' | 'captured' | 'refunded' | 'failed';
  method: string;
  error_description?: string | null;
}
export interface RzpRefund {
  id: string;
  payment_id: string;
  amount: number;
  status: 'pending' | 'processed' | 'failed';
}

export class RazorpayError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** Ids the dummy gateway hands out: the amount and a shared random part, so a payment id says which order it pays. */
const DUMMY_ORDER = /^order_DMY(\d+)x([0-9a-f]{12})$/;
const DUMMY_PAYMENT = /^pay_DMY(\d+)x([0-9a-f]{12})(?:_(upi|card|netbanking|wallet))?$/;

/**
 * Thin Razorpay REST client (orders, payments, refunds) + signature checks. Keys from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET.
 *
 * PAYMENT_GATEWAY=dummy swaps Razorpay for a stand-in that never moves money, also on a live server: orders still wait
 * for payment, the app shows a test payment screen (pay or fail), the payment is checked with a server signature, and
 * refunds go through at once. Everything that uses this client (orders, lab bookings, refunds) works unchanged.
 */
@Injectable()
export class RazorpayClient {
  private readonly logger = new Logger('Razorpay');

  get dummy() {
    return process.env.PAYMENT_GATEWAY?.trim().toLowerCase() === 'dummy';
  }
  get keyId() {
    return this.dummy ? 'dummy' : process.env.RAZORPAY_KEY_ID?.trim() || '';
  }
  private get secret() {
    return process.env.RAZORPAY_KEY_SECRET?.trim() || '';
  }
  get enabled() {
    return this.dummy || !!(this.keyId && this.secret);
  }
  get testMode() {
    return this.dummy || this.keyId.startsWith('rzp_test_');
  }

  /** What the app needs to open the payment screen for gateway order `orderId`: Razorpay Checkout, or the dummy one. */
  checkoutFields(orderId: string): { gateway: 'RAZORPAY'; dummy?: undefined } | { gateway: 'DUMMY'; dummy: { paymentId: string; signature: string } } {
    if (!this.dummy) return { gateway: 'RAZORPAY' };
    const m = DUMMY_ORDER.exec(orderId);
    if (!m) throw new RazorpayError('Not a dummy payment order', 400);
    return { gateway: 'DUMMY', dummy: { paymentId: `pay_DMY${m[1]}x${m[2]}`, signature: this.dummySignature(orderId) } };
  }

  /** Signed with a server secret, so only a payment screen this server opened can mark an order paid. */
  private dummySignature(orderId: string) {
    const key = process.env.ORDER_QR_SECRET?.trim() || process.env.JWT_PRIVATE_KEY?.trim() || 'delivez-dummy-payments';
    return createHmac('sha256', key).update(`dummy|${orderId}`).digest('hex');
  }

  private dummyPayment(id: string): RzpPayment {
    const m = DUMMY_PAYMENT.exec(id);
    if (!m) throw new RazorpayError('Payment not found', 404, 'BAD_REQUEST_ERROR');
    return { id, order_id: `order_DMY${m[1]}x${m[2]}`, amount: Number(m[1]), currency: 'INR', status: 'captured', method: m[3] ?? 'upi', error_description: null };
  }

  private async call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const res = await fetch(API + path, {
      method,
      headers: { authorization: 'Basic ' + Buffer.from(`${this.keyId}:${this.secret}`).toString('base64'), 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { error?: { code?: string; description?: string } };
    if (!res.ok) {
      const msg = json.error?.description ?? `Razorpay ${res.status}`;
      this.logger.warn(`${method} ${path} → ${res.status} ${json.error?.code ?? ''} ${msg}`);
      throw new RazorpayError(msg, res.status, json.error?.code);
    }
    return json as T;
  }

  async createOrder(amount: number, receipt: string, notes: Record<string, string>) {
    if (this.dummy) return { id: `order_DMY${amount}x${randomBytes(6).toString('hex')}`, amount, currency: 'INR', receipt: receipt.slice(0, 40), status: 'created' } satisfies RzpOrder;
    return this.call<RzpOrder>('POST', '/orders', { amount, currency: 'INR', receipt: receipt.slice(0, 40), notes });
  }
  async getOrder(id: string) {
    if (this.dummy) {
      const m = DUMMY_ORDER.exec(id);
      if (!m) throw new RazorpayError('Order not found', 404);
      return { id, amount: Number(m[1]), currency: 'INR', receipt: '', status: 'created' } satisfies RzpOrder;
    }
    return this.call<RzpOrder>('GET', `/orders/${id}`);
  }
  async orderPayments(id: string) {
    // A dummy payment exists only once the app sends it back, so there is never one to find afterwards.
    if (this.dummy) return { items: [] as RzpPayment[] };
    return this.call<{ items: RzpPayment[] }>('GET', `/orders/${id}/payments`);
  }
  async getPayment(id: string) {
    if (this.dummy) return this.dummyPayment(id);
    return this.call<RzpPayment>('GET', `/payments/${id}`);
  }
  async capture(id: string, amount: number) {
    if (this.dummy) return this.dummyPayment(id);
    return this.call<RzpPayment>('POST', `/payments/${id}/capture`, { amount, currency: 'INR' });
  }
  async refund(paymentId: string, amount: number, notes: Record<string, string>) {
    if (this.dummy) return { id: `rfnd_DMY${randomBytes(6).toString('hex')}`, payment_id: paymentId, amount, status: 'processed' } satisfies RzpRefund;
    return this.call<RzpRefund>('POST', `/payments/${paymentId}/refund`, { amount, speed: 'normal', notes });
  }
  async getRefund(paymentId: string, refundId: string) {
    if (this.dummy) return { id: refundId, payment_id: paymentId, amount: 0, status: 'processed' } satisfies RzpRefund;
    return this.call<RzpRefund>('GET', `/payments/${paymentId}/refunds/${refundId}`);
  }

  /** Checkout success: HMAC-SHA256(order_id|payment_id, key secret). Dummy: the server's own signature for the order. */
  checkoutSignatureOk(orderId: string, paymentId: string, signature: string) {
    if (this.dummy) return DUMMY_PAYMENT.test(paymentId) && safeEqual(this.dummySignature(orderId), signature);
    return safeEqual(createHmac('sha256', this.secret).update(`${orderId}|${paymentId}`).digest('hex'), signature);
  }

  /** Webhook: HMAC-SHA256(raw body, webhook secret). */
  webhookSignatureOk(rawBody: Buffer, signature: string) {
    if (this.dummy) return false;
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET?.trim();
    if (!secret) return false;
    return safeEqual(createHmac('sha256', secret).update(rawBody).digest('hex'), signature);
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && timingSafeEqual(x, y);
}
