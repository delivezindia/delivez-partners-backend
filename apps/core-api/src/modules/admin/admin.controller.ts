import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ApiRequest } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps } from '../identity/auth.decorators';
import { AdminGuard, AdminRoles, CurrentAdmin, ROLES, type AdminContext } from './admin.guard';
import { AdminService } from './admin.service';
import { StoreLifecycleService, type LifecycleAction } from './store-lifecycle.service';

const STORE_STATUSES = ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'LIVE', 'LIMITED', 'PAUSED', 'SUSPENDED', 'REJECTED', 'CLOSED'] as const;

const pipelineQuery = z.object({
  status: z.enum(STORE_STATUSES).optional(),
  vertical: z.enum(['EAT', 'GROCERY', 'PHARMACY', 'DIAGNOSTICS', 'LOCAL_STORES']).optional(),
  q: z.string().trim().max(80).optional(),
});
const docQueueQuery = z.object({ status: z.enum(['PENDING', 'VERIFIED', 'REJECTED', 'EXPIRING']).default('PENDING') });
const byStoreQuery = z.object({
  filter: z.enum(['NEEDS_REVIEW', 'MISSING', 'COMPLETE', 'ALL']).default('NEEDS_REVIEW'),
  vertical: z.enum(['EAT', 'GROCERY', 'PHARMACY', 'DIAGNOSTICS', 'LOCAL_STORES']).optional(),
  q: z.string().trim().max(80).optional(),
});
const noticeSchema = z.object({ message: z.string().trim().min(5, 'Write at least 5 characters').max(500) });
const memberSchema = z.object({ isActive: z.boolean(), reason: z.string().trim().max(300).optional() });
const verifySchema = z.object({
  documentNumber: z.string().trim().max(40).optional(),
  expiresAt: z.coerce.date().optional(),
});
const rejectSchema = z.object({ reason: z.string().trim().min(5, 'Tell the partner what to fix (5+ characters)').max(300) });
const reasonSchema = z.object({ reason: z.string().trim().max(500).optional() });

const ACTIONS: Record<string, { action: LifecycleAction; roles: typeof ROLES.READ }> = {
  'start-review': { action: 'START_REVIEW', roles: ROLES.APPROVE_STORES },
  'approve-live': { action: 'APPROVE_LIVE', roles: ROLES.APPROVE_STORES },
  'approve-limited': { action: 'APPROVE_LIMITED', roles: ROLES.APPROVE_STORES },
  'request-changes': { action: 'REQUEST_CHANGES', roles: ROLES.APPROVE_STORES },
  reject: { action: 'REJECT', roles: ROLES.APPROVE_STORES },
  suspend: { action: 'SUSPEND', roles: ROLES.SUSPEND_STORES },
  reinstate: { action: 'REINSTATE', roles: ROLES.REINSTATE_STORES },
  pause: { action: 'PAUSE', roles: ROLES.OPERATE_STORES },
  resume: { action: 'RESUME', roles: ROLES.OPERATE_STORES },
};

@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly lifecycle: StoreLifecycleService,
  ) {}

  @Get('dashboard')
  dashboard(@CurrentAdmin() admin: AdminContext) {
    return this.admin.dashboard(admin);
  }

  @Get('me')
  me(@CurrentAdmin() admin: AdminContext) {
    return this.admin.me(admin);
  }

  @Get('onboarding/pipeline')
  pipeline(@Query(new ZodValidationPipe(pipelineQuery)) query: z.infer<typeof pipelineQuery>, @CurrentAdmin() admin: AdminContext) {
    return this.admin.pipeline(admin, query);
  }

  @Get('stores/:storeId')
  store(@Param('storeId', ParseUUIDPipe) storeId: string, @CurrentAdmin() admin: AdminContext) {
    return this.admin.storeDetail(storeId, admin);
  }

  @Get('documents')
  documents(@Query(new ZodValidationPipe(docQueueQuery)) query: z.infer<typeof docQueueQuery>, @CurrentAdmin() admin: AdminContext) {
    return this.admin.documentQueue(admin, query.status);
  }

  @Get('documents/by-store')
  documentsByStore(@Query(new ZodValidationPipe(byStoreQuery)) query: z.infer<typeof byStoreQuery>, @CurrentAdmin() admin: AdminContext) {
    return this.admin.documentsByStore(admin, query);
  }

  @Post('documents/:id/verify')
  @HttpCode(200)
  @AdminRoles(...ROLES.VERIFY_DOCUMENTS)
  verify(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(verifySchema)) body: z.infer<typeof verifySchema>,
    @CurrentAdmin() admin: AdminContext,
    @Req() req: ApiRequest,
  ) {
    return this.admin.reviewDocument(id, { action: 'VERIFY', ...body }, admin, { ip: req.ip, correlationId: req.correlationId });
  }

  @Post('documents/:id/reject')
  @HttpCode(200)
  @AdminRoles(...ROLES.VERIFY_DOCUMENTS)
  reject(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(rejectSchema)) body: z.infer<typeof rejectSchema>,
    @CurrentAdmin() admin: AdminContext,
    @Req() req: ApiRequest,
  ) {
    return this.admin.reviewDocument(id, { action: 'REJECT', reason: body.reason }, admin, { ip: req.ip, correlationId: req.correlationId });
  }

  // Store lifecycle actions share one handler; each still has its own role list.
  @Post('stores/:storeId/start-review')
  @HttpCode(200)
  @AdminRoles(...ACTIONS['start-review'].roles)
  startReview(@Param('storeId', ParseUUIDPipe) id: string, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.lifecycle.transition(id, 'START_REVIEW', a, { ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/approve-live')
  @HttpCode(200)
  @AdminRoles(...ACTIONS['approve-live'].roles)
  approveLive(@Param('storeId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.lifecycle.transition(id, 'APPROVE_LIVE', a, { reason: b.reason, ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/approve-limited')
  @HttpCode(200)
  @AdminRoles(...ACTIONS['approve-limited'].roles)
  approveLimited(@Param('storeId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.lifecycle.transition(id, 'APPROVE_LIMITED', a, { reason: b.reason, ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/request-changes')
  @HttpCode(200)
  @AdminRoles(...ACTIONS['request-changes'].roles)
  requestChanges(@Param('storeId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.lifecycle.transition(id, 'REQUEST_CHANGES', a, { reason: b.reason, ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/reject')
  @HttpCode(200)
  @AdminRoles(...ACTIONS.reject.roles)
  rejectStore(@Param('storeId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.lifecycle.transition(id, 'REJECT', a, { reason: b.reason, ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/suspend')
  @HttpCode(200)
  @AdminRoles(...ACTIONS.suspend.roles)
  suspend(@Param('storeId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.lifecycle.transition(id, 'SUSPEND', a, { reason: b.reason, ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/reinstate')
  @HttpCode(200)
  @AdminRoles(...ACTIONS.reinstate.roles)
  reinstate(@Param('storeId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.lifecycle.transition(id, 'REINSTATE', a, { reason: b.reason, ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/pause')
  @HttpCode(200)
  @AdminRoles(...ACTIONS.pause.roles)
  pause(@Param('storeId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.lifecycle.transition(id, 'PAUSE', a, { reason: b.reason, ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/resume')
  @HttpCode(200)
  @AdminRoles(...ACTIONS.resume.roles)
  resume(@Param('storeId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.lifecycle.transition(id, 'RESUME', a, { reason: b.reason, ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/notices')
  @AdminRoles(...ROLES.OPERATE_STORES)
  notice(@Param('storeId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noticeSchema)) b: z.infer<typeof noticeSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.admin.sendNotice(id, b.message, a, { ip: r.ip, correlationId: r.correlationId });
  }

  @Post('stores/:storeId/members/:memberId/access')
  @HttpCode(200)
  @AdminRoles(...ROLES.MANAGE_PARTNER_USERS)
  memberAccess(
    @Param('storeId', ParseUUIDPipe) id: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(new ZodValidationPipe(memberSchema)) b: z.infer<typeof memberSchema>,
    @CurrentAdmin() a: AdminContext,
    @Req() r: ApiRequest,
  ) {
    return this.admin.setMemberActive(id, memberId, b.isActive, b.reason, a, { ip: r.ip, correlationId: r.correlationId });
  }
}
