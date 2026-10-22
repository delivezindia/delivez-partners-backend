import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { OtpPurpose } from '@delivez/db';
import { PrismaService } from '../../prisma/prisma.service';
import { KvService } from '../../common/kv/kv.service';
import { ApiError } from '../../common/api-exception.filter';
import { OTP_SENDER, type OtpSender } from './otp-sender';
import { showOtpInResponse } from './otp-visibility';

const OTP_TTL_SECONDS = 5 * 60;
const RESEND_AFTER_SECONDS = 30;
const MAX_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;


@Injectable()
export class OtpService implements OnModuleInit {
  private readonly pepper = process.env.OTP_PEPPER ?? 'dev-otp-pepper';

  constructor(
    private readonly prisma: PrismaService,
    private readonly kv: KvService,
    @Inject(OTP_SENDER) private readonly sender: OtpSender,
  ) {}

  onModuleInit() {
    if (process.env.NODE_ENV === 'production' && showOtpInResponse()) {
      new Logger('OTP').warn('OTP_SHOW_IN_RESPONSE is ON: login codes are shown on screen to anyone. Turn it off (or set SMS_PROVIDER=MSG91) before real partners use the app.');
    }
  }

  async request(phone: string, purpose: OtpPurpose, channel: 'SMS' | 'WHATSAPP') {
    const cooldownKey = `otp:cooldown:${phone}:${purpose}`;
    const wait = await this.kv.ttl(cooldownKey);
    if (wait > 0) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_RESEND_TOO_SOON', `Please wait ${wait}s before requesting a new code`, {
        retryAfter: wait,
      });
    }
    const sent = await this.kv.incr(`otp:hourly:${phone}`, 60 * 60);
    if (sent > MAX_PER_HOUR) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_RATE_LIMITED', 'Too many codes requested. Try again in an hour.');
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const otp = await this.prisma.otpRequest.create({
      data: {
        phone,
        purpose,
        channel,
        codeHash: this.hash(code),
        expiresAt: new Date(Date.now() + OTP_TTL_SECONDS * 1000),
      },
    });
    await this.kv.set(cooldownKey, '1', RESEND_AFTER_SECONDS);
    await this.sender.send(phone, code, channel);

    return {
      requestId: otp.id,
      expiresIn: OTP_TTL_SECONDS,
      retryAfter: RESEND_AFTER_SECONDS,
      // Dev always; production only during the temporary OTP_SHOW_IN_RESPONSE window (see showOtpInResponse).
      ...(showOtpInResponse() ? { devCode: code } : {}),
    };
  }

  /** Consumes the OTP and returns the verified phone number. */
  async verify(requestId: string, code: string): Promise<{ phone: string; purpose: OtpPurpose }> {
    const otp = await this.prisma.otpRequest.findUnique({ where: { id: requestId } });
    if (!otp || otp.usedAt) throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'This code is no longer valid. Request a new one.');
    if (otp.expiresAt < new Date()) throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED', 'This code has expired. Request a new one.');
    if (otp.attempts >= MAX_ATTEMPTS) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_TOO_MANY_ATTEMPTS', 'Too many wrong attempts. Request a new code.');
    }

    const ok = this.safeEqual(otp.codeHash, this.hash(code));
    // Conditional update guards against two concurrent verifies of the same code.
    const updated = await this.prisma.otpRequest.updateMany({
      where: { id: otp.id, usedAt: null, attempts: otp.attempts },
      data: ok ? { attempts: { increment: 1 }, usedAt: new Date() } : { attempts: { increment: 1 } },
    });
    if (!ok || updated.count === 0) {
      const left = MAX_ATTEMPTS - otp.attempts - 1;
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INCORRECT', `Incorrect code. ${Math.max(left, 0)} attempts left.`);
    }
    await this.kv.del(`otp:cooldown:${otp.phone}:${otp.purpose}`);
    return { phone: otp.phone, purpose: otp.purpose };
  }

  private hash(code: string) {
    return createHmac('sha256', this.pepper).update(code).digest('hex');
  }

  private safeEqual(a: string, b: string) {
    const ab = Buffer.from(a);
    const bb = Buffer.from(b);
    return ab.length === bb.length && timingSafeEqual(ab, bb);
  }
}
