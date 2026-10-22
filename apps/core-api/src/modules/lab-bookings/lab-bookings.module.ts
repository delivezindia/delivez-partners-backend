import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { FilesModule } from '../files/files.module';
import { PartnersModule } from '../partners/partners.module';
import { AdminLabBookingsController, DevLabBookingsController, PartnerLabBookingsController } from './lab-bookings.controller';
import { LabBookingsService } from './lab-bookings.service';
import { LabSimulatorService } from './lab-simulator.service';

@Module({
  imports: [PartnersModule, FilesModule],
  controllers: [PartnerLabBookingsController, DevLabBookingsController, AdminLabBookingsController],
  providers: [LabBookingsService, LabSimulatorService, AdminGuard],
})
export class LabBookingsModule {}
