import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequireIdempotency } from '../../common/idempotency.interceptor';
import type { ApiRequest, AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps, CurrentUser } from '../identity/auth.decorators';
import type { StoreAccess } from '../partners/partner-access.service';
import { CurrentStore, PartnerRoles, StoreAccessGuard } from '../partners/store-access.guard';
import { PharmacyService, RX_REJECT_REASONS, type PharmacyActor } from './pharmacy.service';

// Everyone who handles orders can see who is on duty; owners/managers manage pharmacists;
// the review itself is for a registered pharmacist (or an owner/manager naming the one who checked it).
const SEE = ['OWNER', 'MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST'] as const;
const LEADS = ['OWNER', 'MANAGER'] as const;
const REVIEW = ['OWNER', 'MANAGER', 'PHARMACIST'] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 09:00');
const shifts = z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), startsAt: hhmm, endsAt: hhmm })).max(7);
const addSchema = z.object({
  name: z.string().trim().min(3).max(80),
  registrationNo: z.string().trim().min(3).max(40),
  stateCouncil: z.string().trim().min(3).max(80),
  shifts,
  consent: z.literal(true, { errorMap: () => ({ message: 'The pharmacist must confirm they will check every prescription' }) }),
});
const shiftsSchema = z.object({ shifts });
const dutySchema = z.object({ mode: z.enum(['ON', 'OFF', 'SHIFTS']) });
const loginSchema = z.object({ userId: z.string().uuid().nullable() });
const approveSchema = z.object({
  pharmacistId: z.string().uuid().optional(),
  doctorName: z.string().trim().min(3, 'Enter the doctor’s name').max(120),
  doctorRegNo: z.string().trim().min(3, 'Enter the doctor’s registration number').max(40),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter the prescription date'),
  patientName: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(300).optional(),
  attest: z.literal(true, { errorMap: () => ({ message: 'Confirm a registered pharmacist checked this prescription' }) }),
});
const rejectSchema = z
  .object({ reason: z.enum(RX_REJECT_REASONS), note: z.string().trim().max(200).optional(), pharmacistId: z.string().uuid().optional() })
  .refine((v) => v.reason !== 'OTHER' || !!v.note, { message: 'Tell the customer why', path: ['note'] });

const actor = (u: AuthUser, s: StoreAccess, r: ApiRequest): PharmacyActor => ({ kind: 'PARTNER', userId: u.userId, role: s.role, ip: r.ip, correlationId: r.correlationId });

@ApiTags('pharmacy')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('partners/stores/:storeId')
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  @Get('pharmacists')
  @PartnerRoles(...SEE)
  list(@Param('storeId', ParseUUIDPipe) storeId: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess) {
    return this.pharmacy.pharmacists(storeId, { userId: u.userId, role: s.role });
  }

  @Post('pharmacists')
  @PartnerRoles(...LEADS)
  add(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(addSchema)) b: z.infer<typeof addSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.pharmacy.addPharmacist(storeId, b, actor(u, s, r));
  }

  @Put('pharmacists/:id/shifts')
  @PartnerRoles(...LEADS)
  shifts(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(shiftsSchema)) b: z.infer<typeof shiftsSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.pharmacy.setShifts(storeId, id, b.shifts, actor(u, s, r));
  }

  @Post('pharmacists/:id/duty')
  @HttpCode(200)
  @PartnerRoles(...REVIEW)
  duty(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(dutySchema)) b: z.infer<typeof dutySchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.pharmacy.setDuty(storeId, id, b.mode, actor(u, s, r));
  }

  @Put('pharmacists/:id/login')
  @PartnerRoles(...LEADS)
  login(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(loginSchema)) b: z.infer<typeof loginSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.pharmacy.setLogin(storeId, id, b.userId, actor(u, s, r));
  }

  @Delete('pharmacists/:id')
  @PartnerRoles('OWNER')
  remove(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.pharmacy.remove(storeId, id, actor(u, s, r));
  }

  @Get('orders/:orderId/prescription')
  @PartnerRoles(...REVIEW)
  files(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.pharmacy.prescriptionFiles(storeId, orderId, actor(u, s, r));
  }

  @Post('orders/:orderId/rx-approve')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...REVIEW)
  approve(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body(new ZodValidationPipe(approveSchema)) b: z.infer<typeof approveSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    const { attest: _attest, ...input } = b;
    return this.pharmacy.approve(storeId, orderId, input, actor(u, s, r));
  }

  @Post('orders/:orderId/rx-reject')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...REVIEW)
  reject(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body(new ZodValidationPipe(rejectSchema)) b: z.infer<typeof rejectSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.pharmacy.reject(storeId, orderId, b, actor(u, s, r));
  }
}
