import { Module } from '@nestjs/common';
import { PartnersModule } from '../partners/partners.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ImportService } from './import.service';
import { InventoryService } from './inventory.service';

@Module({
  imports: [PartnersModule],
  controllers: [CatalogController],
  providers: [CatalogService, InventoryService, ImportService],
  exports: [CatalogService, InventoryService],
})
export class CatalogModule {}
