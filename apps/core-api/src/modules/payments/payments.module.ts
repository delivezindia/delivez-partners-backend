import { Controller, Headers, HttpCode, Module, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../identity/auth.decorators';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsService } from './payments.service';
import { RazorpayClient } from './razorpay.client';

/** Razorpay → us. Set the URL https://<api>/v1/payments/razorpay/webhook and RAZORPAY_WEBHOOK_SECRET in the dashboard. */
@Controller('payments')
export class PaymentsWebhookController {
  constructor(private readonly payments: PaymentsService) {}

  @Public()
  @Post('razorpay/webhook')
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature?: string) {
    return this.payments.webhook(req.rawBody, signature);
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [PaymentsWebhookController],
  providers: [PaymentsService, RazorpayClient],
  exports: [PaymentsService],
})
export class PaymentsModule {}
