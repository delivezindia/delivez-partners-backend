import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import type { ApiRequest, AuthUser } from '../../common/request-context';
import { CurrentUser, Public } from './auth.decorators';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { indianPhone } from './phone';

const otpRequestSchema = z.object({
  phone: indianPhone,
  purpose: z.enum(['LOGIN', 'ONBOARDING']).default('LOGIN'),
  channel: z.enum(['SMS', 'WHATSAPP']).default('SMS'),
});

const otpVerifySchema = z.object({
  requestId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
  app: z.enum(['PARTNERS', 'LOCAL', 'ADMIN', 'RIDER', 'ONE']),
  device: z.record(z.unknown()).optional(),
});

const refreshSchema = z.object({ refreshToken: z.string().min(10) });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly auth: AuthService,
  ) {}

  @Public()
  @Post('otp/request')
  @HttpCode(200)
  requestOtp(@Body(new ZodValidationPipe(otpRequestSchema)) body: z.infer<typeof otpRequestSchema>) {
    return this.otp.request(body.phone, body.purpose, body.channel);
  }

  @Public()
  @Post('otp/verify')
  @HttpCode(200)
  async verifyOtp(@Body(new ZodValidationPipe(otpVerifySchema)) body: z.infer<typeof otpVerifySchema>, @Req() req: ApiRequest) {
    const { phone } = await this.otp.verify(body.requestId, body.code);
    return this.auth.login(phone, body.app, {
      ip: req.ip,
      userAgent: req.header('user-agent'),
      device: body.device,
      correlationId: req.correlationId,
    });
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  refresh(@Body(new ZodValidationPipe(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @ApiBearerAuth()
  @Post('logout')
  @HttpCode(204)
  async logout(@CurrentUser() user: AuthUser, @Req() req: ApiRequest) {
    await this.auth.logout(user.userId, user.sessionId, req.ip);
  }
}
