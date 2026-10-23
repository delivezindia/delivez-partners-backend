import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { SystemController } from './system.controller';

@Module({
  imports: [NotificationsModule],
  controllers: [SystemController],
  providers: [AdminGuard],
})
export class SystemModule {}
