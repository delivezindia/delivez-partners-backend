import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { z } from 'zod';
import type { ApiRequest, AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps, CurrentUser } from '../identity/auth.decorators';
import { OnboardingService, type Actor } from '../onboarding/onboarding.service';
import type { StoreAccess } from '../partners/partner-access.service';
import { CurrentStore, PartnerRoles, StoreAccessGuard } from '../partners/store-access.guard';
import { SettingsService } from './settings.service';
import {
  holidaySchema,
  inviteSchema,
  legalAcceptSchema,
  memberUpdateSchema,
  pinSchema,
  pinSwitchSchema,
  settingsSchema,
  timingsSchema,
} from './settings.schemas';
import { StaffService } from './staff.service';

const actorOf = (user: AuthUser, req: ApiRequest): Actor => ({ userId: user.userId, ip: req.ip, userAgent: req.header('user-agent'), correlationId: req.correlationId, channel: 'WEB' });

// Store settings (P25) and staff (P24) — plan §5.5, §4.3.
@ApiTags('store settings')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('partners/stores/:storeId')
export class StoresController {
  constructor(
    private readonly settings: SettingsService,
    private readonly staff: StaffService,
    private readonly onboarding: OnboardingService,
  ) {}

  // Settings -----------------------------------------------------------

  @Get('settings')
  @PartnerRoles('OWNER', 'MANAGER')
  getSettings(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.settings.get(storeId);
  }

  @Patch('settings')
  @PartnerRoles('OWNER', 'MANAGER')
  updateSettings(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(settingsSchema)) body: z.infer<typeof settingsSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.settings.update(storeId, body, actorOf(u, r));
  }

  @Put('timings')
  @PartnerRoles('OWNER', 'MANAGER')
  timings(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(timingsSchema)) body: z.infer<typeof timingsSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.settings.replaceTimings(storeId, body.timings, actorOf(u, r));
  }

  @Post('holidays')
  @PartnerRoles('OWNER', 'MANAGER')
  addHoliday(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(holidaySchema)) body: z.infer<typeof holidaySchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.settings.addHoliday(storeId, body.date, body.reason, actorOf(u, r));
  }

  @Delete('holidays/:holidayId')
  @PartnerRoles('OWNER', 'MANAGER')
  removeHoliday(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('holidayId', ParseUUIDPipe) holidayId: string, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.settings.removeHoliday(storeId, holidayId, actorOf(u, r));
  }

  @Get('bank-account')
  @PartnerRoles('OWNER', 'ACCOUNTANT')
  bank(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.settings.bank(storeId);
  }

  @Get('legal')
  legal(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.onboarding.legalFor(storeId);
  }

  @Post('legal/accept')
  @HttpCode(200)
  @PartnerRoles('OWNER')
  acceptLegal(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(legalAcceptSchema)) body: z.infer<typeof legalAcceptSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.onboarding.acceptLegal(storeId, body.acceptedDocIds, actorOf(u, r));
  }

  // Staff ----------------------------------------------------------------

  @Get('staff')
  @PartnerRoles('OWNER', 'MANAGER')
  listStaff(@Param('storeId', ParseUUIDPipe) storeId: string, @CurrentStore() access: StoreAccess) {
    return this.staff.list(storeId, access);
  }

  @Post('staff')
  @PartnerRoles('OWNER', 'MANAGER')
  invite(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(inviteSchema)) body: z.infer<typeof inviteSchema>, @CurrentStore() access: StoreAccess, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.staff.invite(storeId, body, access, actorOf(u, r));
  }

  @Patch('staff/:memberId')
  @PartnerRoles('OWNER', 'MANAGER')
  updateMember(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body(new ZodValidationPipe(memberUpdateSchema)) body: z.infer<typeof memberUpdateSchema>,
    @CurrentStore() access: StoreAccess,
    @CurrentUser() u: AuthUser,
    @Req() r: ApiRequest,
  ) {
    return this.staff.update(storeId, memberId, body, access, actorOf(u, r));
  }

  @Delete('staff/:memberId')
  @HttpCode(204)
  @PartnerRoles('OWNER', 'MANAGER')
  async removeMember(@Param('memberId', ParseUUIDPipe) memberId: string, @CurrentStore() access: StoreAccess, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    await this.staff.remove(memberId, access, actorOf(u, r));
  }

  /** Any team member sets their own 4-digit PIN for shared tablets. */
  @Put('staff/me/pin')
  setPin(@Body(new ZodValidationPipe(pinSchema)) body: z.infer<typeof pinSchema>, @CurrentStore() access: StoreAccess, @CurrentUser() u: AuthUser) {
    return this.staff.setPin(access, u.userId, body.pin);
  }

  @Get('pin-switch')
  switchable(@Param('storeId', ParseUUIDPipe) storeId: string, @CurrentStore() access: StoreAccess) {
    return this.staff.switchable(storeId, access);
  }

  @Post('pin-switch')
  @HttpCode(200)
  pinSwitch(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(pinSwitchSchema)) body: z.infer<typeof pinSwitchSchema>, @CurrentStore() access: StoreAccess, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.staff.pinSwitch(storeId, body.memberId, body.pin, { userId: u.userId, sessionId: u.sessionId }, access, {
      ip: r.ip,
      userAgent: r.header('user-agent'),
      correlationId: r.correlationId,
      device: { platform: 'WEB' },
    });
  }
}
