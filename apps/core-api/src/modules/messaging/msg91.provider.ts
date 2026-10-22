import { Logger } from '@nestjs/common';
import type { MessageProvider, OutboundMessage } from './messaging.service';

const FLOW_URL = 'https://control.msg91.com/api/v5/flow';

/**
 * MSG91 SMS via the v5 Flow API (DLT-approved templates; no free text).
 * Each of our template codes maps to an MSG91 template id: MSG91_TEMPLATE_<CODE>, e.g. MSG91_TEMPLATE_OTP.
 * Template variables in MSG91 must use the same names as `vars` (e.g. ##otp##, ##order##, ##minutes##, ##link##).
 */
export class Msg91SmsProvider implements MessageProvider {
  readonly name = 'MSG91';
  private readonly logger = new Logger('MSG91');

  constructor(private readonly authKey: string) {}

  static templateFor(code: string) {
    return process.env[`MSG91_TEMPLATE_${code}`] || null;
  }

  async send(m: OutboundMessage) {
    const templateId = Msg91SmsProvider.templateFor(m.template);
    if (!templateId) return { status: 'FAILED' as const, error: `No MSG91 template configured for ${m.template} (set MSG91_TEMPLATE_${m.template})` };
    const mobiles = m.to.replace(/\D/g, '').replace(/^(?!91)(\d{10})$/, '91$1');
    const res = await fetch(FLOW_URL, {
      method: 'POST',
      headers: { authkey: this.authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [{ mobiles, ...(m.vars ?? {}) }] }),
    });
    const body = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
    // MSG91 queues first and validates later: 'success' means accepted (request id), not delivered.
    // Delivery shows in the MSG91 dashboard (or a delivery-report webhook, which needs a public URL).
    if (res.ok && body.type === 'success') return { status: 'ACCEPTED' as const, providerMsgId: body.message };
    this.logger.warn(`Send failed for ${m.template} (${res.status}): ${body.message ?? 'no detail'}`);
    return { status: 'FAILED' as const, error: `${res.status} ${body.message ?? 'MSG91 error'}` };
  }
}
