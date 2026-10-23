import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { PartnersModule } from '../partners/partners.module';
import { DispatchService } from './dispatch.service';
import { OrderJobsScheduler } from './order-jobs.scheduler';
import { OrderStateService } from './order-state.service';
import { AdminOrdersController, DevOrdersController, PartnerOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrderReportsController } from './order-reports.controller';
import { OrderReportsService } from './order-reports.service';
import { SimulatorService } from './simulator.service';

@Module({
  imports: [PartnersModule],
  controllers: [PartnerOrdersController, DevOrdersController, AdminOrdersController, OrderReportsController],
  providers: [OrderStateService, OrdersService, DispatchService, SimulatorService, OrderJobsScheduler, OrderReportsService, AdminGuard],
  exports: [OrderStateService, OrdersService, OrderReportsService],
})
export class OrdersModule {}
