import { Body, Controller, HttpCode, HttpStatus, Module, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from '../../common/api-exception.filter';
import { localParts } from '../../common/hours';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { CatalogModule } from '../catalog/catalog.module';
import { Apps } from '../identity/auth.decorators';
import { OrdersModule } from '../orders/orders.module';
import { PartnersModule } from '../partners/partners.module';
import { PartnerRoles, StoreAccessGuard } from '../partners/store-access.guard';
import { DigestsService } from './digests.service';

const runSchema = z.object({ kind: z.enum(['EXPIRY', 'SUMMARY']) });

/** Dev only: send today's expiry alert / summary now (ignores the clock and the once-a-day rule). */
@ApiTags('dev')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('dev/stores/:storeId/digests')
export class DevDigestsController {
  constructor(private readonly digests: DigestsService) {}

  @Post('run')
  @HttpCode(200)
  @PartnerRoles('OWNER', 'MANAGER')
  run(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(runSchema)) b: z.infer<typeof runSchema>) {
    if (process.env.NODE_ENV === 'production') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    const { date } = localParts(new Date(), 'Asia/Kolkata');
    return b.kind === 'EXPIRY' ? this.digests.expiry(storeId, date, true) : this.digests.summary(storeId, date, true);
  }
}

@Module({
  imports: [PartnersModule, CatalogModule, OrdersModule],
  controllers: [DevDigestsController],
  providers: [DigestsService],
})
export class DigestsModule {}
