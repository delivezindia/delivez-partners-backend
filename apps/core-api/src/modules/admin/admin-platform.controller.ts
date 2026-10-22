import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ApiRequest } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps } from '../identity/auth.decorators';
import { indianPhone } from '../identity/phone';
import { AdminGuard, AdminRoles, CurrentAdmin, ROLES, type AdminContext } from './admin.guard';
import { AdminPlatformService } from './admin-platform.service';

const ADMIN_ROLES = ['FOUNDER', 'HEAD_OF_OPS', 'REGIONAL_HEAD', 'CITY_OPS', 'COMPLIANCE', 'FINANCE', 'LEGAL', 'SUPPORT', 'SALES_AGENT', 'AUDITOR'] as const;
const LEGAL_TYPES = ['PARTNER_TNC', 'SLA_TERMS', 'STATE_RIDER', 'PENALTY_FRAMEWORK', 'CUSTOMER_TNC', 'PRIVACY_POLICY', 'RX_DECLARATION', 'WHATSAPP_OPT_IN'] as const;

const addAdminSchema = z.object({
  phone: indianPhone,
  fullName: z.string().trim().min(2).max(80),
  role: z.enum(ADMIN_ROLES),
  cityIds: z.array(z.string().uuid()).max(50).default([]),
});
const updateAdminSchema = z
  .object({ role: z.enum(ADMIN_ROLES).optional(), cityIds: z.array(z.string().uuid()).max(50).optional(), isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change');

const lat = z.coerce.number().min(6).max(37);
const lng = z.coerce.number().min(68).max(98);
const addCitySchema = z.object({ name: z.string().trim().min(2).max(60), state: z.string().trim().min(2).max(60), centerLat: lat, centerLng: lng });
const updateCitySchema = z.object({ isActive: z.boolean().optional(), centerLat: lat.optional(), centerLng: lng.optional() });
const zoneSchema = z.object({ name: z.string().trim().min(2).max(60) });
const updateZoneSchema = z.object({ isActive: z.boolean().optional(), name: z.string().trim().min(2).max(60).optional() });
const pincodesSchema = z.object({
  // Accepts a pasted list: "560001, 560002\n560038"
  codes: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(/[\s,;]+/)).map((c) => c.trim()).filter(Boolean))
    .pipe(z.array(z.string().regex(/^[1-9]\d{5}$/, 'PIN codes are 6 digits')).min(1).max(500)),
  zoneId: z.string().uuid().nullable().optional(),
  serviceable: z.boolean().default(true),
});
const publishLegalSchema = z.object({
  type: z.enum(LEGAL_TYPES),
  version: z.string().trim().min(1).max(20),
  state: z.string().trim().max(60).nullable().optional(),
  contentUrl: z.string().trim().url().max(500),
  effectiveFrom: z.coerce.date(),
});
const legalActiveSchema = z.object({ isActive: z.boolean() });
const auditQuery = z.object({
  entity: z.string().max(40).optional(),
  entityId: z.string().max(60).optional(),
  actorType: z.enum(['USER', 'ADMIN', 'SYSTEM', 'AI']).optional(),
  action: z.string().max(20).optional(),
  before: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminPlatformController {
  constructor(private readonly platform: AdminPlatformService) {}

  // --- Team ---------------------------------------------------------
  @Get('team')
  @AdminRoles(...ROLES.MANAGE_TEAM)
  team() {
    return this.platform.team();
  }

  @Post('team')
  @AdminRoles(...ROLES.MANAGE_TEAM)
  addAdmin(@Body(new ZodValidationPipe(addAdminSchema)) body: z.infer<typeof addAdminSchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.platform.addAdmin(body, me, { ip: r.ip });
  }

  @Patch('team/:id')
  @AdminRoles(...ROLES.MANAGE_TEAM)
  updateAdmin(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateAdminSchema)) body: z.infer<typeof updateAdminSchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.platform.updateAdmin(id, body, me, { ip: r.ip });
  }

  // --- Cities, zones, PIN codes -------------------------------------
  @Get('cities')
  cities() {
    return this.platform.cities();
  }

  @Post('cities')
  @AdminRoles(...ROLES.MANAGE_GEO)
  addCity(@Body(new ZodValidationPipe(addCitySchema)) body: z.infer<typeof addCitySchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.platform.addCity(body, me, { ip: r.ip });
  }

  @Patch('cities/:id')
  @AdminRoles(...ROLES.MANAGE_GEO)
  updateCity(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateCitySchema)) body: z.infer<typeof updateCitySchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.platform.updateCity(id, body, me, { ip: r.ip });
  }

  @Post('cities/:id/zones')
  @AdminRoles(...ROLES.MANAGE_GEO)
  addZone(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(zoneSchema)) body: z.infer<typeof zoneSchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.platform.addZone(id, body.name, me, { ip: r.ip });
  }

  @Patch('zones/:id')
  @AdminRoles(...ROLES.MANAGE_GEO)
  updateZone(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(updateZoneSchema)) body: z.infer<typeof updateZoneSchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.platform.updateZone(id, body, me, { ip: r.ip });
  }

  @Get('cities/:id/pincodes')
  pincodes(@Param('id', ParseUUIDPipe) id: string) {
    return this.platform.pincodes(id);
  }

  @Post('cities/:id/pincodes')
  @HttpCode(200)
  @AdminRoles(...ROLES.MANAGE_GEO)
  upsertPincodes(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(pincodesSchema)) body: z.infer<typeof pincodesSchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.platform.upsertPincodes(id, body, me, { ip: r.ip });
  }

  // --- Legal ----------------------------------------------------------
  @Get('legal')
  legal() {
    return this.platform.legalDocs();
  }

  @Post('legal')
  @AdminRoles(...ROLES.MANAGE_LEGAL)
  publishLegal(@Body(new ZodValidationPipe(publishLegalSchema)) body: z.infer<typeof publishLegalSchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.platform.publishLegal(body, me, { ip: r.ip });
  }

  @Patch('legal/:id')
  @AdminRoles(...ROLES.MANAGE_LEGAL)
  setLegalActive(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(legalActiveSchema)) body: z.infer<typeof legalActiveSchema>, @CurrentAdmin() me: AdminContext, @Req() r: ApiRequest) {
    return this.platform.setLegalActive(id, body.isActive, me, { ip: r.ip });
  }

  // --- Audit log ------------------------------------------------------
  @Get('audit')
  @AdminRoles(...ROLES.VIEW_AUDIT)
  audit(@Query(new ZodValidationPipe(auditQuery)) q: z.infer<typeof auditQuery>) {
    return this.platform.auditLog(q);
  }
}
