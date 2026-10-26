import { Module } from '@nestjs/common';
import { GeoModule } from '../geo/geo.module';
import { PartnersModule } from '../partners/partners.module';
import { BankService } from './bank.service';
import { DocumentsService } from './documents.service';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { IfscService } from './ifsc.service';

@Module({
  imports: [GeoModule, PartnersModule],
  controllers: [OnboardingController],
  providers: [OnboardingService, DocumentsService, BankService, IfscService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
