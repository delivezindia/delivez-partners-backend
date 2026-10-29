import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { FilesModule } from '../files/files.module';
import { PartnersModule } from '../partners/partners.module';
import { DispatchService } from './dispatch.service';
import { OrderJobsScheduler } from './order-jobs.scheduler';
import { OrderStateService } from './order-state.service';
import { AdminOrdersController, DevOrdersController, PartnerOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderReportsController } from './order-reports.controller';
import { OrderReportsService } from './order-reports.service';
import { SimulatorService } from './simulator.service';
import { SubstitutionsService } from './substitutions.service';
import { ReturnsService } from './returns.service';
import { NotificationsModule } from '../notifications/notifications.module';
import { CouponsModule } from '../coupons/coupons.module';
import { OpsAlertsController } from './ops-alerts.controller';
import { OpsAlertsService } from './ops-alerts.service';

@Module({
  imports: [PartnersModule, FilesModule, NotificationsModule, CouponsModule],
  controllers: [PartnerOrdersController, DevOrdersController, AdminOrdersController, OrderReportsController, OpsAlertsController],
  providers: [OrderStateService, OrdersService, DispatchService, SimulatorService, SubstitutionsService, ReturnsService, OpsAlertsService, OrderJobsScheduler, OrderReportsService, AdminGuard],
  exports: [OrderStateService, OrdersService, OrderReportsService, SimulatorService, SubstitutionsService, ReturnsService],
})
export class OrdersModule {}
