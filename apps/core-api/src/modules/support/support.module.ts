import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { PartnersModule } from '../partners/partners.module';
import { AdminSupportController, PartnerSupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [PartnersModule],
  controllers: [PartnerSupportController, AdminSupportController],
  providers: [SupportService, AdminGuard],
})
export class SupportModule {}
