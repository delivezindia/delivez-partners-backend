import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ApiRequest } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps } from '../identity/auth.decorators';
import { AdminGuard, AdminRoles, CurrentAdmin, ROLES, type AdminContext } from '../admin/admin.guard';
import type { OrderActor } from './order-state.service';
import { ALERT_ACTIONS, OpsAlertsService } from './ops-alerts.service';

const actor = (a: AdminContext, r: ApiRequest): OrderActor => ({ kind: 'ADMIN', userId: a.userId, role: a.role, correlationId: r.correlationId });
const OPS = [...ROLES.OPERATE_STORES, 'SUPPORT' as const];
const ackSchema = z.object({ action: z.enum(ALERT_ACTIONS).optional() });
const noteSchema = z.object({ note: z.string().trim().max(300).optional() });
const prepSchema = z.object({ minutes: z.number().int().min(1).max(60), reason: z.string().trim().min(2).max(200).default('Updated by Delivez ops') });
const logQuery = z.object({ from: z.coerce.date().optional(), level: z.enum(['LIKELY', 'BREACHED']).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) });
const reassignSchema = z.object({ mode: z.enum(['ALL', 'ONE']).default('ALL') });

/** Live ops board: alert levels per order, acknowledge / act / resolve, audit log, rider panel. */
@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin/ops')
export class OpsAlertsController {
  constructor(private readonly ops: OpsAlertsService) {}

  @Get('board')
  board(@CurrentAdmin() a: AdminContext) {
    return this.ops.board(a.cityIds);
  }

  @Post('alerts/:id/ack')
  @HttpCode(200)
  @AdminRoles(...OPS)
  ack(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(ackSchema)) b: z.infer<typeof ackSchema>, @CurrentAdmin() a: AdminContext) {
    return this.ops.acknowledge([id], a, b.action);
  }

  @Post('alerts/ack-all')
  @HttpCode(200)
  @AdminRoles(...OPS)
  ackAll(@CurrentAdmin() a: AdminContext) {
    return this.ops.acknowledgeAll(a);
  }

  @Post('alerts/:id/resolve')
  @HttpCode(200)
  @AdminRoles(...OPS)
  resolve(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) b: z.infer<typeof noteSchema>, @CurrentAdmin() a: AdminContext) {
    return this.ops.resolve(id, a, b.note);
  }

  @Get('alerts/log')
  log(@Query(new ZodValidationPipe(logQuery)) q: z.infer<typeof logQuery>, @CurrentAdmin() a: AdminContext) {
    return this.ops.log(a, q);
  }

  @Post('orders/:id/prep')
  @HttpCode(200)
  @AdminRoles(...ROLES.OPERATE_STORES)
  prep(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(prepSchema)) b: z.infer<typeof prepSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.ops.updatePrep(id, b.minutes, b.reason, a, actor(a, r));
  }

  @Post('orders/:id/escalate')
  @HttpCode(200)
  @AdminRoles(...OPS)
  escalate(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(noteSchema)) b: z.infer<typeof noteSchema>, @CurrentAdmin() a: AdminContext) {
    return this.ops.escalate(id, b.note, a);
  }

  @Post('orders/:id/apology')
  @HttpCode(200)
  @AdminRoles(...OPS)
  apology(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.ops.apologise(id, a, actor(a, r));
  }

  @Post('tasks/:id/release')
  @HttpCode(200)
  @AdminRoles(...ROLES.OPERATE_STORES)
  release(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.ops.releaseRider(id, a, actor(a, r));
  }

  @Get('riders')
  riders(@CurrentAdmin() a: AdminContext) {
    return this.ops.riders(a.cityIds);
  }

  @Post('riders/:id/pause')
  @HttpCode(200)
  @AdminRoles(...ROLES.OPERATE_STORES)
  pause(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.pauseRider(id, true);
  }

  @Post('riders/:id/resume')
  @HttpCode(200)
  @AdminRoles(...ROLES.OPERATE_STORES)
  resume(@Param('id', ParseUUIDPipe) id: string) {
    return this.ops.pauseRider(id, false);
  }

  @Post('riders/:id/reassign')
  @HttpCode(200)
  @AdminRoles(...ROLES.OPERATE_STORES)
  reassign(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reassignSchema)) b: z.infer<typeof reassignSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.ops.reassign(id, b.mode, a, actor(a, r));
  }
}
