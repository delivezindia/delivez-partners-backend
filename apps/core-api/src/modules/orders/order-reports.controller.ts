import { Controller, Get, Param, ParseUUIDPipe, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps } from '../identity/auth.decorators';
import { PartnerRoles, StoreAccessGuard } from '../partners/store-access.guard';
import { OrderReportsService } from './order-reports.service';

/** Sales numbers are for the people who run the money side, not every staff member. */
const MONEY = ['OWNER', 'MANAGER', 'ACCOUNTANT'] as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const summaryQuery = z.object({ days: z.coerce.number().pipe(z.union([z.literal(1), z.literal(7), z.literal(30)])).default(1) });
const csvQuery = z.object({ from: day, to: day });

@ApiTags('reports')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('partners/stores/:storeId/reports')
export class OrderReportsController {
  constructor(private readonly reports: OrderReportsService) {}

  @Get('summary')
  @PartnerRoles(...MONEY)
  summary(@Param('storeId', ParseUUIDPipe) storeId: string, @Query(new ZodValidationPipe(summaryQuery)) q: z.infer<typeof summaryQuery>) {
    return this.reports.summary(storeId, q.days as 1 | 7 | 30);
  }

  @Get('orders.csv')
  @PartnerRoles(...MONEY)
  async csv(@Param('storeId', ParseUUIDPipe) storeId: string, @Query(new ZodValidationPipe(csvQuery)) q: z.infer<typeof csvQuery>, @Res() res: Response) {
    const r = await this.reports.csv(storeId, q.from, q.to);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${r.filename}"`);
    res.setHeader('x-row-count', String(r.count));
    res.send(r.body);
  }
}
