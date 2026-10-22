import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Msg91SmsProvider } from './msg91.provider';

export type MessageChannel = 'SMS' | 'WHATSAPP';

export interface OutboundMessage {
  channel: MessageChannel;
  /** E.164, e.g. +919000000001 */
  to: string;
  /** Template code, e.g. OTP, ORDER_REMINDER — maps to the DLT / WhatsApp template at the provider. */
  template: string;
  /** Full text: shown in the dev phone and the log. Real gateways send the approved template + vars instead. */
  body: string;
  /** Template variables, e.g. { otp: '123456' } — names must match the provider template. */
  vars?: Record<string, string>;
  userId?: string | null;
}

/** One gateway per channel. */
export interface MessageProvider {
  readonly name: string;
  send(m: OutboundMessage): Promise<{ status: 'DELIVERED_DEV' | 'ACCEPTED' | 'FAILED'; providerMsgId?: string; error?: string }>;
}

/** Local "dev phone": nothing leaves the machine — the message is recorded and shown in Admin → Messages (dev). */
class DevProvider implements MessageProvider {
  readonly name = 'DEV';
  private readonly logger = new Logger('DevPhone');
  async send(m: OutboundMessage) {
    this.logger.log(`[${m.channel} → ${m.to}] ${m.body}`);
    return { status: 'DELIVERED_DEV' as const };
  }
}

const last10 = (p: string) => p.replace(/\D/g, '').slice(-10);

/**
 * SMS / WhatsApp gateway (Step 12). Every message is written to `message_logs`.
 * SMS_PROVIDER=MSG91 (+ MSG91_AUTH_KEY, MSG91_TEMPLATE_<CODE>) sends real SMS; WhatsApp is DEV-only for now.
 * Outside production, real messages only go to MSG91_TEST_NUMBERS — everything else stays on the dev phone,
 * so demo numbers (which may belong to real people) never get texts and test runs don't burn credits.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);
  private readonly dev = new DevProvider();
  private readonly providers: Record<MessageChannel, MessageProvider>;
  private readonly testNumbers = new Set((process.env.MSG91_TEST_NUMBERS ?? '').split(',').map(last10).filter((n) => n.length === 10));
  private readonly prod = process.env.NODE_ENV === 'production';

  constructor(private readonly prisma: PrismaService) {
    this.providers = { SMS: this.pickSms(), WHATSAPP: this.pickWhatsApp() };
  }

  private pickSms(): MessageProvider {
    const wanted = (process.env.SMS_PROVIDER ?? 'DEV').toUpperCase();
    if (wanted === 'MSG91') {
      const key = process.env.MSG91_AUTH_KEY;
      if (key) {
        this.logger.log(`SMS via MSG91${this.prod ? '' : ` — dev: real SMS only to ${this.testNumbers.size} test number(s) in MSG91_TEST_NUMBERS`}`);
        return new Msg91SmsProvider(key);
      }
      this.logger.warn('SMS_PROVIDER=MSG91 but MSG91_AUTH_KEY is empty — using the local dev phone');
    }
    if (this.prod) this.logger.error('SMS is using the DEV provider in production — messages are NOT delivered');
    return this.dev;
  }

  private pickWhatsApp(): MessageProvider {
    const wanted = (process.env.WHATSAPP_PROVIDER ?? 'DEV').toUpperCase();
    if (wanted !== 'DEV') this.logger.warn(`WHATSAPP_PROVIDER=${wanted} is not available yet — using the local dev phone`);
    return this.dev;
  }

  providerFor(channel: MessageChannel) {
    return this.providers[channel].name;
  }

  /** Real gateway, unless we're outside production and the number isn't a registered test number. */
  private route(m: OutboundMessage): MessageProvider {
    const p = this.providers[m.channel];
    if (p === this.dev || this.prod) return p;
    return this.testNumbers.has(last10(m.to)) ? p : this.dev;
  }

  async send(m: OutboundMessage) {
    const provider = this.route(m);
    let result: Awaited<ReturnType<MessageProvider['send']>>;
    try {
      result = await provider.send(m);
    } catch (e) {
      result = { status: 'FAILED', error: (e as Error).message };
    }
    return this.prisma.messageLog.create({
      data: { channel: m.channel, toPhone: m.to, userId: m.userId ?? null, templateCode: m.template, body: m.body, provider: provider.name, status: result.status, providerMsgId: result.providerMsgId, error: result.error },
    });
  }

  /** Dev inbox for the admin console. */
  list(opts: { phone?: string; channel?: MessageChannel; limit: number }) {
    const digits = opts.phone?.replace(/\D/g, '').slice(-10);
    return this.prisma.messageLog.findMany({
      where: { ...(digits ? { toPhone: { endsWith: digits } } : {}), ...(opts.channel ? { channel: opts.channel } : {}) },
      orderBy: { createdAt: 'desc' },
      take: opts.limit,
    });
  }
}
