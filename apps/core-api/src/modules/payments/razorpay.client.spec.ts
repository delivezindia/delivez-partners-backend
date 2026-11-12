import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { RazorpayClient } from './razorpay.client';

describe('RazorpayClient with PAYMENT_GATEWAY=dummy', () => {
  const saved = { ...process.env };
  let rzp: RazorpayClient;
  beforeEach(() => {
    process.env.PAYMENT_GATEWAY = 'dummy';
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    rzp = new RazorpayClient();
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('is on, in test mode, without Razorpay keys', () => {
    assert.equal(rzp.enabled, true);
    assert.equal(rzp.testMode, true);
    assert.equal(rzp.dummy, true);
  });

  it('pays an order with the id and signature the checkout handed out', async () => {
    const order = await rzp.createOrder(25_000, 'DZ-1', {});
    const c = rzp.checkoutFields(order.id);
    assert.equal(c.gateway, 'DUMMY');
    const paymentId = `${c.dummy!.paymentId}_card`;
    assert.equal(rzp.checkoutSignatureOk(order.id, paymentId, c.dummy!.signature), true);
    const p = await rzp.getPayment(paymentId);
    assert.deepEqual([p.order_id, p.amount, p.status, p.method], [order.id, 25_000, 'captured', 'card']);
  });

  it('refuses a signature made for another order', async () => {
    const a = await rzp.createOrder(100, 'A', {});
    const b = await rzp.createOrder(100, 'B', {});
    const fromA = rzp.checkoutFields(a.id).dummy!;
    assert.equal(rzp.checkoutSignatureOk(b.id, fromA.paymentId, fromA.signature), false);
    assert.equal(rzp.checkoutSignatureOk(a.id, 'pay_somethingElse', fromA.signature), false);
  });

  it('refunds straight away and never accepts webhooks', async () => {
    const r = await rzp.refund('pay_DMY100xabcdefabcdef', 100, {});
    assert.equal(r.status, 'processed');
    assert.equal(rzp.webhookSignatureOk(Buffer.from('{}'), 'x'), false);
    assert.deepEqual((await rzp.orderPayments('order_DMY100xabcdefabcdef')).items, []);
  });

  it('is Razorpay again when the switch is off', () => {
    delete process.env.PAYMENT_GATEWAY;
    process.env.RAZORPAY_KEY_ID = 'rzp_test_x';
    process.env.RAZORPAY_KEY_SECRET = 's';
    assert.equal(rzp.dummy, false);
    assert.equal(rzp.checkoutFields('order_X').gateway, 'RAZORPAY');
    assert.equal(rzp.keyId, 'rzp_test_x');
  });
});
