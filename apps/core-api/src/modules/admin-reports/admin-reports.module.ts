import { Controller, Get, Module, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminGuard, AdminRoles, CurrentAdmin, ROLES, type AdminContext } from '../admin/admin.guard';
import { Apps } from '../identity/auth.decorators';
import { AdminReportsService } from './admin-reports.service';

const citiesQuery = z.object({ weeks: z.coerce.number().pipe(z.union([z.literal(4), z.literal(8), z.literal(12)])).default(8) });
const healthQuery = z.object({ days: z.coerce.number().pipe(z.union([z.literal(7), z.literal(14), z.literal(30)])).default(7) });

@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin/reports')
export class AdminReportsController {
  constructor(private readonly reports: AdminReportsService) {}

  @Get('cities')
  @AdminRoles(...ROLES.READ)
  cities(@Query(new ZodValidationPipe(citiesQuery)) q: z.infer<typeof citiesQuery>, @CurrentAdmin() a: AdminContext) {
    return this.reports.cities(a, q.weeks);
  }

  @Get('cities.csv')
  @AdminRoles(...ROLES.READ)
  async citiesCsv(@Query(new ZodValidationPipe(citiesQuery)) q: z.infer<typeof citiesQuery>, @CurrentAdmin() a: AdminContext, @Res() res: Response) {
    const r = await this.reports.citiesCsv(a, q.weeks);
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="${r.filename}"`);
    res.send(r.body);
  }

  @Get('store-health')
  @AdminRoles(...ROLES.READ)
  health(@Query(new ZodValidationPipe(healthQuery)) q: z.infer<typeof healthQuery>, @CurrentAdmin() a: AdminContext) {
    return this.reports.storeHealth(a, q.days);
  }
}

@Module({
  controllers: [AdminReportsController],
  providers: [AdminReportsService, AdminGuard],
})
export class AdminReportsModule {}
