import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrdersModule } from '../orders/orders.module';
import { AmAssignController, AmController } from './am.controller';
import { AmService } from './am.service';

@Module({
  imports: [NotificationsModule, OrdersModule],
  controllers: [AmController, AmAssignController],
  providers: [AmService, AdminGuard],
})
export class AccountManagersModule {}
