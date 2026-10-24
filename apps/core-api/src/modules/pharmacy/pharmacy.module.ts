import { Module } from '@nestjs/common';
import { FilesModule } from '../files/files.module';
import { OrdersModule } from '../orders/orders.module';
import { PartnersModule } from '../partners/partners.module';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';

@Module({
  imports: [PartnersModule, FilesModule, OrdersModule],
  controllers: [PharmacyController],
  providers: [PharmacyService],
})
export class PharmacyModule {}
