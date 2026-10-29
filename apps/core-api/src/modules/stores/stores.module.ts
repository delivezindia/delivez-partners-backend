import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { PartnersModule } from '../partners/partners.module';
import { OpenStateScheduler } from './open-state.scheduler';
import { ReviewsService } from './reviews.service';
import { SettingsService } from './settings.service';
import { StaffService } from './staff.service';
import { StoresController } from './stores.controller';

@Module({
  imports: [PartnersModule, OnboardingModule],
  controllers: [StoresController],
  providers: [SettingsService, StaffService, OpenStateScheduler, ReviewsService],
  exports: [SettingsService],
})
export class StoresModule {}
