import { Module } from '@nestjs/common';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { AdminController } from './admin.controller';
import { AdminPlatformController } from './admin-platform.controller';
import { AdminPlatformService } from './admin-platform.service';
import { AdminGuard } from './admin.guard';
import { AdminService } from './admin.service';
import { StoreLifecycleService } from './store-lifecycle.service';

@Module({
  imports: [OnboardingModule],
  controllers: [AdminController, AdminPlatformController],
  providers: [AdminGuard, AdminService, AdminPlatformService, StoreLifecycleService],
})
export class AdminModule {}
