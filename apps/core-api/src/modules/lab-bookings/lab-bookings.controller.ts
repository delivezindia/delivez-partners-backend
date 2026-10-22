import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequireIdempotency } from '../../common/idempotency.interceptor';
import type { ApiRequest, AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { AdminGuard, AdminRoles, CurrentAdmin, ROLES, type AdminContext } from '../admin/admin.guard';
import { Apps, CurrentUser } from '../identity/auth.decorators';
import { indianPhone } from '../identity/phone';
import type { StoreAccess } from '../partners/partner-access.service';
import { CurrentStore, PartnerRoles, StoreAccessGuard } from '../partners/store-access.guard';
import { LabBookingsService, type BookingTab, type LabActorCtx } from './lab-bookings.service';
import { LabSimulatorService } from './lab-simulator.service';

// Lab roles: the desk/collectors handle bookings; owners/managers review prescriptions and release reports.
const VIEW = ['OWNER', 'MANAGER', 'COUNTER_STAFF'] as const;
const DESK = ['OWNER', 'MANAGER', 'COUNTER_STAFF'] as const;
const CLINICAL = ['OWNER', 'MANAGER'] as const;

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const listQuery = z.object({ tab: z.enum(['TO_CONFIRM', 'UPCOMING', 'IN_LAB', 'REPORTS', 'CANCELLED', 'ALL']).default('TO_CONFIRM'), date: dateStr.optional() });
const slotsQuery = z.object({ date: dateStr, type: z.enum(['HOME', 'WALK_IN']) });
const reasonSchema = z.object({ reason: z.string().trim().min(5, 'Tell the patient why (5+ characters)').max(300) });
const approveRxSchema = z.object({ doctorName: z.string().trim().max(120).optional(), doctorRegNo: z.string().trim().max(40).optional(), notes: z.string().trim().max(300).optional() });
const collectorSchema = z.object({ name: z.string().trim().min(2).max(80), phone: indianPhone });
const collectSchema = z.object({ otp: z.string().regex(/^\d{4}$/, 'Enter the 4-digit booking code') });
const rescheduleSchema = z.object({ slotStart: z.coerce.date() });
const uploadSchema = z.object({ size: z.number().int().positive().max(10 * 1024 * 1024) });
const rxUploadSchema = z.object({ contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png']), size: z.number().int().positive().max(10 * 1024 * 1024) });
const releaseSchema = z.object({
  fileKey: z.string().max(300),
  pathologistId: z.string().uuid(),
  summary: z.string().trim().max(500).optional(),
  attest: z.literal(true, { errorMap: () => ({ message: 'Confirm the pathologist has reviewed and signed this report' }) }),
  amendReason: z.string().trim().min(5).max(300).optional(),
});
const createSchema = z
  .object({
    customer: z.object({ phone: indianPhone, name: z.string().trim().min(2).max(80).optional() }),
    patient: z.object({ name: z.string().trim().min(2).max(80), age: z.number().int().min(0).max(120).optional(), gender: z.enum(['F', 'M', 'O']).optional() }),
    collectionType: z.enum(['HOME', 'WALK_IN']),
    slotStart: z.coerce.date(),
    testIds: z.array(z.string().uuid()).min(1).max(30),
    paymentMode: z.enum(['COD', 'UPI']),
    address: z.object({ line1: z.string().trim().min(3).max(160), landmark: z.string().trim().max(120).optional(), pincode: z.string().regex(/^\d{6}$/), lat: z.number().min(6).max(38), lng: z.number().min(68).max(98) }).optional(),
    rxSeenByStore: z.boolean().optional(),
    note: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.collectionType === 'WALK_IN' || !!v.address, { message: 'Add the address for home collection', path: ['address'] });
const simulateSchema = z.object({
  count: z.number().int().min(1).max(5).default(1),
  collection: z.enum(['HOME', 'WALK_IN', 'ANY']).default('ANY'),
  rx: z.enum(['YES', 'NO', 'ANY']).default('ANY'),
  payment: z.enum(['COD', 'UPI', 'ANY']).default('ANY'),
});

const partner = (u: AuthUser, s: StoreAccess, r: ApiRequest): LabActorCtx => ({ kind: 'PARTNER', userId: u.userId, role: s.role, ip: r.ip, correlationId: r.correlationId });

@ApiTags('lab-bookings')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('partners/stores/:storeId')
export class PartnerLabBookingsController {
  constructor(private readonly labs: LabBookingsService) {}

  @Get('lab-slots')
  @PartnerRoles(...VIEW)
  slots(@Param('storeId', ParseUUIDPipe) storeId: string, @Query(new ZodValidationPipe(slotsQuery)) q: z.infer<typeof slotsQuery>) {
    return this.labs.slots(storeId, q.date, q.type);
  }

  @Get('lab-pathologists')
  @PartnerRoles(...VIEW)
  pathologists(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.labs.pathologists(storeId);
  }

  @Get('lab-bookings')
  @PartnerRoles(...VIEW)
  list(@Param('storeId', ParseUUIDPipe) storeId: string, @Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.labs.list(storeId, q.tab as BookingTab, q.date);
  }

  @Get('lab-bookings/:idOrNumber')
  @PartnerRoles(...VIEW)
  detail(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('idOrNumber') id: string) {
    return this.labs.detail(storeId, id);
  }

  /** Phone / walk-in bookings entered by the lab (start confirmed). */
  @Post('lab-bookings')
  @RequireIdempotency()
  @PartnerRoles(...DESK)
  create(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(createSchema)) b: z.infer<typeof createSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.create({ storeId, channel: 'PARTNER_MANUAL', collectionType: b.collectionType, slotStart: b.slotStart, customer: b.customer, patient: b.patient, testIds: b.testIds, paymentMode: b.paymentMode, address: b.address, note: b.note, rxSeenByStore: b.rxSeenByStore, startConfirmed: true }, partner(u, s, r));
  }

  @Post('lab-bookings/:id/rx-approve')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...CLINICAL)
  approveRx(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(approveRxSchema)) b: z.infer<typeof approveRxSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.approveRx(storeId, id, b, partner(u, s, r));
  }

  @Post('lab-bookings/:id/rx-reject')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...CLINICAL)
  rejectRx(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.rejectRx(storeId, id, b.reason, partner(u, s, r));
  }

  @Get('lab-bookings/:id/prescription')
  @PartnerRoles(...VIEW)
  prescription(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.prescriptionFile(storeId, id, partner(u, s, r), 'Prescription review');
  }

  @Post('lab-bookings/:id/confirm')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...DESK)
  confirm(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.transition(storeId, id, 'CONFIRM', partner(u, s, r));
  }

  @Post('lab-bookings/:id/reject')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...DESK)
  reject(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.transition(storeId, id, 'REJECT', partner(u, s, r), { reason: b.reason });
  }

  @Post('lab-bookings/:id/collector')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...DESK)
  collector(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(collectorSchema)) b: z.infer<typeof collectorSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.assignCollector(storeId, id, b, partner(u, s, r));
  }

  @Post('lab-bookings/:id/collect')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...DESK)
  collect(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(collectSchema)) b: z.infer<typeof collectSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.collect(storeId, id, b.otp, partner(u, s, r));
  }

  @Post('lab-bookings/:id/processing')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...DESK)
  processing(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.transition(storeId, id, 'START_PROCESSING', partner(u, s, r));
  }

  @Post('lab-bookings/:id/reschedule')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...DESK)
  reschedule(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(rescheduleSchema)) b: z.infer<typeof rescheduleSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.reschedule(storeId, id, b.slotStart, partner(u, s, r));
  }

  @Post('lab-bookings/:id/report-uploads')
  @PartnerRoles(...CLINICAL)
  reportUpload(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(uploadSchema)) b: z.infer<typeof uploadSchema>) {
    return this.labs.reportUpload(storeId, b.size);
  }

  /** Release (or amend) the pathologist-signed report. */
  @Post('lab-bookings/:id/reports')
  @RequireIdempotency()
  @PartnerRoles(...CLINICAL)
  release(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(releaseSchema)) b: z.infer<typeof releaseSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.releaseReport(storeId, id, b, partner(u, s, r));
  }

  @Get('lab-bookings/:id/reports/:reportId/file')
  @PartnerRoles(...VIEW)
  reportFile(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Param('reportId', ParseUUIDPipe) reportId: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.labs.reportFile(id, reportId, partner(u, s, r), 'Lab staff view', storeId);
  }

  @Get('lab-bookings/:id/report-access')
  @PartnerRoles(...CLINICAL)
  accessLog(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.labs.reportAccessLog(storeId, id);
  }

  /** Customer-side upload target (used by the dev simulator now; the Local app later). */
  @Post('lab-rx-uploads')
  @PartnerRoles(...DESK)
  rxUpload(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(rxUploadSchema)) b: z.infer<typeof rxUploadSchema>) {
    return this.labs.rxUpload(storeId, b.contentType, b.size);
  }
}

@ApiTags('lab-bookings')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('dev/stores/:storeId/lab-bookings')
export class DevLabBookingsController {
  constructor(private readonly simulator: LabSimulatorService) {}

  @Post('simulate')
  @PartnerRoles('OWNER', 'MANAGER')
  simulate(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(simulateSchema)) b: z.infer<typeof simulateSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.simulator.simulate(storeId, b, { kind: 'CUSTOMER', userId: u.userId, ip: r.ip, correlationId: r.correlationId });
  }
}

const adminListQuery = z.object({ storeId: z.string().uuid().optional(), status: z.string().max(30).optional(), q: z.string().trim().max(20).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) });
const purposeQuery = z.object({ purpose: z.string().trim().min(5, 'Say why you are opening this report').max(200) });
const admin = (a: AdminContext, r: ApiRequest): LabActorCtx => ({ kind: 'ADMIN', userId: a.userId, role: a.role, ip: r.ip, correlationId: r.correlationId });

@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin/lab-bookings')
export class AdminLabBookingsController {
  constructor(private readonly labs: LabBookingsService) {}

  @Get()
  list(@Query(new ZodValidationPipe(adminListQuery)) q: z.infer<typeof adminListQuery>) {
    return this.labs.adminList(q);
  }

  @Get(':id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.labs.adminDetail(id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @AdminRoles(...ROLES.OPERATE_STORES, 'SUPPORT')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reasonSchema)) b: z.infer<typeof reasonSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.labs.transition(null, id, 'CANCEL', admin(a, r), { reason: b.reason });
  }

  /** Health data: admins must state a purpose; the open is logged. */
  @Get(':id/reports/:reportId/file')
  @AdminRoles('FOUNDER', 'HEAD_OF_OPS', 'COMPLIANCE', 'SUPPORT')
  reportFile(@Param('id', ParseUUIDPipe) id: string, @Param('reportId', ParseUUIDPipe) reportId: string, @Query(new ZodValidationPipe(purposeQuery)) q: z.infer<typeof purposeQuery>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.labs.reportFile(id, reportId, admin(a, r), q.purpose, null);
  }

  @Get(':id/report-access')
  @AdminRoles('FOUNDER', 'HEAD_OF_OPS', 'COMPLIANCE', 'AUDITOR')
  accessLog(@Param('id', ParseUUIDPipe) id: string) {
    return this.labs.reportAccessLog(null, id);
  }
}
