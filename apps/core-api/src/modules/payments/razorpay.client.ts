import { createHmac, timingSafeEqual } from 'node:crypto';
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

/** Thin Razorpay REST client (orders, payments, refunds) + signature checks. Keys from RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET. */
@Injectable()
export class RazorpayClient {
  private readonly logger = new Logger('Razorpay');

  get keyId() {
    return process.env.RAZORPAY_KEY_ID?.trim() || '';
  }
  private get secret() {
    return process.env.RAZORPAY_KEY_SECRET?.trim() || '';
  }
  get enabled() {
    return !!(this.keyId && this.secret);
  }
  get testMode() {
    return this.keyId.startsWith('rzp_test_');
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

  createOrder(amount: number, receipt: string, notes: Record<string, string>) {
    return this.call<RzpOrder>('POST', '/orders', { amount, currency: 'INR', receipt: receipt.slice(0, 40), notes });
  }
  getOrder(id: string) {
    return this.call<RzpOrder>('GET', `/orders/${id}`);
  }
  orderPayments(id: string) {
    return this.call<{ items: RzpPayment[] }>('GET', `/orders/${id}/payments`);
  }
  getPayment(id: string) {
    return this.call<RzpPayment>('GET', `/payments/${id}`);
  }
  capture(id: string, amount: number) {
    return this.call<RzpPayment>('POST', `/payments/${id}/capture`, { amount, currency: 'INR' });
  }
  refund(paymentId: string, amount: number, notes: Record<string, string>) {
    return this.call<RzpRefund>('POST', `/payments/${paymentId}/refund`, { amount, speed: 'normal', notes });
  }
  getRefund(paymentId: string, refundId: string) {
    return this.call<RzpRefund>('GET', `/payments/${paymentId}/refunds/${refundId}`);
  }

  /** Checkout success: HMAC-SHA256(order_id|payment_id, key secret). */
  checkoutSignatureOk(orderId: string, paymentId: string, signature: string) {
    return safeEqual(createHmac('sha256', this.secret).update(`${orderId}|${paymentId}`).digest('hex'), signature);
  }

  /** Webhook: HMAC-SHA256(raw body, webhook secret). */
  webhookSignatureOk(rawBody: Buffer, signature: string) {
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
