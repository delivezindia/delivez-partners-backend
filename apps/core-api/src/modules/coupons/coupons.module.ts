import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ApiRequest } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminGuard, AdminRoles, CurrentAdmin, ROLES, type AdminContext } from '../admin/admin.guard';
import { Apps, Public } from '../identity/auth.decorators';
import { COUPON_KINDS } from './coupon-rules';
import { CouponsService } from './coupons.service';

const VERTICALS = ['EAT', 'GROCERY', 'PHARMACY', 'LOCAL_STORES'] as const;
const paise = z.number().int().min(0).max(10_000_000);
const couponFields = {
  // Letters and digits only, so it is easy to read out and type: WELCOME50, DIWALI20.
  code: z.string().trim().min(3, 'At least 3 characters').max(20).regex(/^[A-Za-z0-9]+$/, 'Letters and numbers only'),
  description: z.string().trim().max(120).nullable().optional(),
  discountType: z.enum(COUPON_KINDS),
  discountValue: paise,
  maxDiscount: paise.nullable().optional(),
  minOrder: paise.default(0),
  vertical: z.enum(VERTICALS).nullable().optional(),
  storeId: z.string().uuid().nullable().optional(),
  cityId: z.string().uuid().nullable().optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perUserLimit: z.number().int().min(1).max(50).default(1),
  firstOrderOnly: z.boolean().default(false),
  isPublic: z.boolean().default(true),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  isActive: z.boolean().optional(),
};
const createSchema = z.object(couponFields);
const updateSchema = z
  .object(couponFields)
  .partial()
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');
const listQuery = z.object({ status: z.enum(['LIVE', 'SCHEDULED', 'ENDED', 'PAUSED']).optional() });

@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin/coupons')
export class AdminCouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  @AdminRoles(...ROLES.READ)
  list(@Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.coupons.list(q.status);
  }

  @Post()
  @AdminRoles(...ROLES.MANAGE_COUPONS)
  create(@Body(new ZodValidationPipe(createSchema)) b: z.infer<typeof createSchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.coupons.create(b, me, r.ip);
  }

  @Patch(':id')
  @AdminRoles(...ROLES.MANAGE_COUPONS)
  update(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateSchema)) b: z.infer<typeof updateSchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.coupons.update(id, b, me, r.ip);
  }

  @Get(':id/redemptions')
  @AdminRoles(...ROLES.READ)
  redemptions(@Param('id', ParseUUIDPipe) id: string) {
    return this.coupons.redemptions(id);
  }
}

/** The customer app's welcome page: offers running now (no login). */
@ApiTags('local')
@Public()
@Controller('local/offers')
export class LocalOffersController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  list() {
    return this.coupons.publicOffers();
  }
}

@Module({
  controllers: [AdminCouponsController, LocalOffersController],
  providers: [CouponsService, AdminGuard],
  exports: [CouponsService],
})
export class CouponsModule {}
