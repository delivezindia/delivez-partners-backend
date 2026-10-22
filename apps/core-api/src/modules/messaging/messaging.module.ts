import { Global, Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { DevMessagesController } from './messaging.controller';
import { MessagingService } from './messaging.service';

@Global()
@Module({
  controllers: [DevMessagesController],
  providers: [MessagingService, AdminGuard],
  exports: [MessagingService],
})
export class MessagingModule {}
