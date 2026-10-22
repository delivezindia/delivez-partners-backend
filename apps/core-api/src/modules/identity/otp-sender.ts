import { Injectable } from '@nestjs/common';
import { MessagingService } from '../messaging/messaging.service';

export interface OtpSender {
  send(phone: string, code: string, channel: 'SMS' | 'WHATSAPP'): Promise<void>;
}

export const OTP_SENDER = Symbol('OTP_SENDER');

/** Login codes go out through the messaging gateway (local dev phone today, MSG91 once DLT is approved). */
@Injectable()
export class MessagingOtpSender implements OtpSender {
  constructor(private readonly messaging: MessagingService) {}

  async send(phone: string, code: string, channel: 'SMS' | 'WHATSAPP') {
    // Wording follows the usual DLT OTP template shape; the real template id is mapped when MSG91 is live.
    await this.messaging.send({ channel, to: phone, template: 'OTP', vars: { otp: code }, body: `${code} is your Delivez login code. It expires in 5 minutes. Do not share it with anyone.` });
  }
}
