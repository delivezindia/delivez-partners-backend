import { Module } from '@nestjs/common';
import { AdminGuard } from '../admin/admin.guard';
import { AdminRidersController } from './admin-riders.controller';
import { AdminRidersService } from './admin-riders.service';
import { RiderRegistrationService } from './rider-registration.service';
import { RidersController } from './riders.controller';

/** Delivery partner (rider) app: sign-up, and its review by ops. Login itself is /v1/auth with app RIDER. */
@Module({
  controllers: [RidersController, AdminRidersController],
  providers: [RiderRegistrationService, AdminRidersService, AdminGuard],
})
export class RidersModule {}
