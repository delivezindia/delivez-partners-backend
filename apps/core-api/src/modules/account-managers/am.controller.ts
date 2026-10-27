import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from '../../common/api-exception.filter';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps } from '../identity/auth.decorators';
import { AdminGuard, AdminRoles, CurrentAdmin, ROLES, type AdminContext } from '../admin/admin.guard';
import { AmService } from './am.service';

const AM = 'ACCOUNT_MANAGER' as const;
const listQuery = z.object({ sort: z.enum(['risk', 'sla', 'orders', 'name']).default('risk') });
const logSchema = z.object({
  kind: z.enum(['CALL', 'WHATSAPP', 'NOTE', 'VISIT']),
  note: z.string().trim().max(1000).optional(),
  // Notes written offline carry an id from the phone, so a retry after reconnecting logs once.
  clientId: z.string().uuid().optional(),
  at: z.coerce.date().optional(),
});
const prepSchema = z.object({ minutes: z.number().int(), reason: z.string().trim().max(200).optional() });
const applySchema = z.object({ kind: z.enum(['PREP_UP', 'PREP_DOWN', 'ESCALATE_RIDERS', 'VISIT', 'CALL_COMPLAINTS', 'CALL_REJECTIONS']) });
const taskSchema = z.object({
  storeId: z.string().uuid(),
  kind: z.enum(['CALL', 'VISIT', 'TEST_ORDER', 'FOLLOW_UP']),
  title: z.string().trim().min(2).max(140),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  dueAt: z.coerce.date(),
});
const tasksQuery = z.object({ tab: z.enum(['today', 'overdue', 'upcoming', 'done']).default('today') });
const issuesQuery = z.object({ status: z.enum(['open', 'resolved']).default('open') });
const noteSchema = z.object({ note: z.string().trim().max(500).optional() });
const assignSchema = z.object({ accountManagerId: z.string().uuid().nullable() });

/** The account manager's own mobile view: only their assigned stores. */
@ApiTags('admin-account-managers')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@AdminRoles(AM)
@Controller('admin/am')
export class AmController {
  constructor(private readonly am: AmService) {}

  @Get('home')
  home(@CurrentAdmin() a: AdminContext) {
    return this.am.home(a);
  }

  @Get('stores')
  stores(@Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>, @CurrentAdmin() a: AdminContext) {
    return this.am.list(a, q.sort);
  }

  @Get('stores/:storeId')
  store(@Param('storeId', ParseUUIDPipe) storeId: string, @CurrentAdmin() a: AdminContext) {
    return this.am.detail(a, storeId);
  }

  @Post('stores/:storeId/log')
  log(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(logSchema)) b: z.infer<typeof logSchema>, @CurrentAdmin() a: AdminContext) {
    return this.am.log(a, storeId, b);
  }

  @Put('stores/:storeId/prep')
  prep(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(prepSchema)) b: z.infer<typeof prepSchema>, @CurrentAdmin() a: AdminContext) {
    return this.am.setPrep(a, storeId, b.minutes, b.reason);
  }

  @Post('stores/:storeId/apply')
  apply(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(applySchema)) b: z.infer<typeof applySchema>, @CurrentAdmin() a: AdminContext) {
    return this.am.apply(a, storeId, b.kind);
  }

  @Post('stores/:storeId/test-order')
  testOrder(@Param('storeId', ParseUUIDPipe) storeId: string, @CurrentAdmin() a: AdminContext) {
    if (process.env.NODE_ENV === 'production')
      throw new ApiError(HttpStatus.NOT_IMPLEMENTED, 'TEST_ORDERS_LATER', 'Test orders on live stores come with the payments module — add a “Run test order” task for now');
    return this.am.testOrder(a, storeId);
  }

  @Get('tasks')
  tasks(@Query(new ZodValidationPipe(tasksQuery)) q: z.infer<typeof tasksQuery>, @CurrentAdmin() a: AdminContext) {
    return this.am.tasks(a, q.tab);
  }

  @Post('tasks')
  addTask(@Body(new ZodValidationPipe(taskSchema)) b: z.infer<typeof taskSchema>, @CurrentAdmin() a: AdminContext) {
    return this.am.addTask(a, b.storeId, b);
  }

  @Post('tasks/:id/done')
  @HttpCode(200)
  done(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) b: z.infer<typeof noteSchema>, @CurrentAdmin() a: AdminContext) {
    return this.am.completeTask(a, id, b.note);
  }

  @Get('issues')
  issues(@Query(new ZodValidationPipe(issuesQuery)) q: z.infer<typeof issuesQuery>, @CurrentAdmin() a: AdminContext) {
    return this.am.issues(a, q.status);
  }

  @Post('issues/:id/escalate')
  @HttpCode(200)
  escalate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) b: z.infer<typeof noteSchema>, @CurrentAdmin() a: AdminContext) {
    return this.am.escalate(a, id, b.note);
  }

  @Post('issues/:id/resolve')
  @HttpCode(200)
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) b: z.infer<typeof noteSchema>, @CurrentAdmin() a: AdminContext) {
    return this.am.resolve(a, id, b.note);
  }
}

/** City ops and above: who the account managers are, and which stores each one looks after. */
@ApiTags('admin-account-managers')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin')
export class AmAssignController {
  constructor(private readonly am: AmService) {}

  @Get('account-managers')
  managers(@CurrentAdmin() a: AdminContext) {
    return this.am.managers(a);
  }

  @Put('stores/:storeId/account-manager')
  @AdminRoles(...ROLES.OPERATE_STORES)
  assign(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(assignSchema)) b: z.infer<typeof assignSchema>, @CurrentAdmin() a: AdminContext) {
    return this.am.assign(a, storeId, b.accountManagerId);
  }

  /** Dev only: run the hourly churn / order-drop check now. */
  @Post('am/dev/health-check')
  @AdminRoles(...ROLES.OPERATE_STORES)
  @HttpCode(200)
  healthCheck() {
    if (process.env.NODE_ENV === 'production') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    return this.am.healthCheck();
  }
}
