import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { MessagingOtpSender, OTP_SENDER } from './otp-sender';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    TokenService,
    OtpService,
    AuthService,
    { provide: OTP_SENDER, useClass: MessagingOtpSender },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService, AuthService],
})
export class IdentityModule {}
