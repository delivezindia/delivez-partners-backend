import { Module } from '@nestjs/common';
import { FcmPushSender } from './fcm-push-sender';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushSender } from './push-sender';

@Module({
  controllers: [NotificationsController],
  // FcmPushSender falls back to logging when no service account is present (local dev without keys).
  providers: [NotificationsService, { provide: PushSender, useClass: FcmPushSender }],
  exports: [NotificationsService],
})
export class NotificationsModule {}
