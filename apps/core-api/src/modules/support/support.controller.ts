import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminGuard, AdminRoles, CurrentAdmin, ROLES, type AdminContext } from '../admin/admin.guard';
import { Apps, CurrentUser } from '../identity/auth.decorators';
import type { StoreAccess } from '../partners/partner-access.service';
import { CurrentStore, PartnerRoles, StoreAccessGuard } from '../partners/store-access.guard';
import { PARTNER_CATEGORIES, SupportService } from './support.service';

const EVERYONE = ['OWNER', 'MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST', 'ACCOUNTANT'] as const;
/** Who answers tickets in the admin console. */
export const SUPPORT_ROLES = ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD', 'CITY_OPS', 'SUPPORT'] as const;

const createSchema = z.object({
  category: z.enum(PARTNER_CATEGORIES),
  subject: z.string().trim().min(5, 'Say in a few words what it is about').max(120),
  message: z.string().trim().min(10, 'Tell us a bit more').max(2000),
  orderNumber: z.string().trim().regex(/^DEL-\d+$/i, 'Order numbers look like DEL-123456').optional(),
});
const replySchema = z.object({ body: z.string().trim().min(1).max(2000) });
const adminReplySchema = z.object({ body: z.string().trim().min(1).max(2000), status: z.enum(['WAITING_ON_USER', 'RESOLVED', 'IN_PROGRESS']).default('WAITING_ON_USER') });
const adminStatusSchema = z.object({ status: z.enum(['OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED']) });
const adminListQuery = z.object({ status: z.enum(['ACTIVE', 'ALL', 'OPEN', 'IN_PROGRESS', 'WAITING_ON_USER', 'RESOLVED', 'CLOSED']).optional(), q: z.string().trim().max(60).optional() });

const viewer = (u: AuthUser, s: StoreAccess) => ({ userId: u.userId, role: s.role });

@ApiTags('support')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('partners/stores/:storeId/support/tickets')
export class PartnerSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @PartnerRoles(...EVERYONE)
  list(@Param('storeId', ParseUUIDPipe) storeId: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess) {
    return this.support.partnerList(storeId, viewer(u, s));
  }

  @Post()
  @PartnerRoles(...EVERYONE)
  create(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(createSchema)) b: z.infer<typeof createSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess) {
    return this.support.create(storeId, b, viewer(u, s));
  }

  @Get(':id')
  @PartnerRoles(...EVERYONE)
  get(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess) {
    return this.support.partnerGet(storeId, id, viewer(u, s));
  }

  @Post(':id/messages')
  @PartnerRoles(...EVERYONE)
  reply(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(replySchema)) b: z.infer<typeof replySchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess) {
    return this.support.partnerReply(storeId, id, b.body, viewer(u, s));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @PartnerRoles(...EVERYONE)
  resolve(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess) {
    return this.support.partnerResolve(storeId, id, viewer(u, s));
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin/support/tickets')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @AdminRoles(...ROLES.READ)
  list(@Query(new ZodValidationPipe(adminListQuery)) q: z.infer<typeof adminListQuery>, @CurrentAdmin() a: AdminContext) {
    return this.support.adminList(a, q);
  }

  @Get(':id')
  @AdminRoles(...ROLES.READ)
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() a: AdminContext) {
    return this.support.adminGet(a, id);
  }

  @Post(':id/messages')
  @AdminRoles(...SUPPORT_ROLES)
  reply(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(adminReplySchema)) b: z.infer<typeof adminReplySchema>, @CurrentAdmin() a: AdminContext) {
    return this.support.adminReply(a, id, b.body, b.status);
  }

  @Post(':id/status')
  @HttpCode(200)
  @AdminRoles(...SUPPORT_ROLES)
  status(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(adminStatusSchema)) b: z.infer<typeof adminStatusSchema>, @CurrentAdmin() a: AdminContext) {
    return this.support.adminStatus(a, id, b.status);
  }

  @Post(':id/assign')
  @HttpCode(200)
  @AdminRoles(...SUPPORT_ROLES)
  assign(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() a: AdminContext) {
    return this.support.adminAssign(a, id);
  }
}
