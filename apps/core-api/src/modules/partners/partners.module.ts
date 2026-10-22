import { Module } from '@nestjs/common';
import { PartnerAccessService } from './partner-access.service';
import { PartnersController } from './partners.controller';
import { StoreAccessGuard } from './store-access.guard';

@Module({
  controllers: [PartnersController],
  providers: [PartnerAccessService, StoreAccessGuard],
  exports: [PartnerAccessService],
})
export class PartnersModule {}
