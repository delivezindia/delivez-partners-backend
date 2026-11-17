import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ApiRequest } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ZodQuery } from '../../common/zod-query';
import { Apps } from '../identity/auth.decorators';
import { AdminGuard, AdminRoles, CurrentAdmin, ROLES, type AdminContext } from '../admin/admin.guard';
import { AdminRidersService } from './admin-riders.service';

const listQuery = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'CHANGES_REQUESTED', 'APPROVED', 'REJECTED']).optional(),
  search: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Tell the rider what to fix (5+ characters)').max(500) });
const approveSchema = z.object({ cityId: z.string().uuid().optional() });

/**
 * Rider sign-up review for ops — admin console and hub management call these with an ADMIN-app token.
 * Reading needs any admin role; changing needs ROLES.MANAGE_RIDERS. City-scoped admins only see their cities.
 */
@ApiTags('admin · riders')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin/riders')
export class AdminRidersController {
  constructor(private readonly riders: AdminRidersService) {}

  @Get('applications')
  list(@ZodQuery(listQuery) q: z.infer<typeof listQuery>, @CurrentAdmin() admin: AdminContext) {
    return this.riders.list(admin, q);
  }

  @Get('applications/:id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: AdminContext) {
    return this.riders.get(admin, id);
  }

  @AdminRoles(...ROLES.MANAGE_RIDERS)
  @Post('applications/:id/start-review')
  @HttpCode(200)
  startReview(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() admin: AdminContext) {
    return this.riders.startReview(admin, id);
  }

  @AdminRoles(...ROLES.MANAGE_RIDERS)
  @Post('applications/:id/documents/:docId/verify')
  @HttpCode(200)
  verifyDoc(@Param('id', ParseUUIDPipe) id: string, @Param('docId', ParseUUIDPipe) docId: string, @CurrentAdmin() admin: AdminContext) {
    return this.riders.verifyDocument(admin, id, docId);
  }

  @AdminRoles(...ROLES.MANAGE_RIDERS)
  @Post('applications/:id/documents/:docId/reject')
  @HttpCode(200)
  rejectDoc(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('docId', ParseUUIDPipe) docId: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
    @CurrentAdmin() admin: AdminContext,
  ) {
    return this.riders.rejectDocument(admin, id, docId, body.reason);
  }

  @AdminRoles(...ROLES.MANAGE_RIDERS)
  @Post('applications/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(approveSchema)) body: z.infer<typeof approveSchema>, @CurrentAdmin() admin: AdminContext) {
    return this.riders.approve(admin, id, body.cityId);
  }

  @AdminRoles(...ROLES.MANAGE_RIDERS)
  @Post('applications/:id/request-changes')
  @HttpCode(200)
  requestChanges(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>, @CurrentAdmin() admin: AdminContext) {
    return this.riders.requestChanges(admin, id, body.reason);
  }

  @AdminRoles(...ROLES.MANAGE_RIDERS)
  @Post('applications/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>, @CurrentAdmin() admin: AdminContext) {
    return this.riders.reject(admin, id, body.reason);
  }

  @AdminRoles(...ROLES.MANAGE_RIDERS)
  @Post(':riderId/suspend')
  @HttpCode(200)
  suspend(@Param('riderId', ParseUUIDPipe) riderId: string, @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>, @CurrentAdmin() admin: AdminContext, @Req() req: ApiRequest) {
    return this.riders.suspend(admin, riderId, body.reason, req.ip);
  }

  @AdminRoles(...ROLES.MANAGE_RIDERS)
  @Post(':riderId/reinstate')
  @HttpCode(200)
  reinstate(@Param('riderId', ParseUUIDPipe) riderId: string, @CurrentAdmin() admin: AdminContext, @Req() req: ApiRequest) {
    return this.riders.reinstate(admin, riderId, req.ip);
  }
}
