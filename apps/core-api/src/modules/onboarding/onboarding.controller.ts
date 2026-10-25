import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { OnboardingChannel } from '@delivez/db';
import type { ApiRequest, AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps, CurrentUser } from '../identity/auth.decorators';
import { PartnerRoles, StoreAccessGuard } from '../partners/store-access.guard';
import { BankService } from './bank.service';
import { DocumentsService } from './documents.service';
import { STEP_SCHEMAS, type StepKey } from './flows';
import { OnboardingService, type Actor } from './onboarding.service';

const STORE_TYPES = [
  'RESTAURANT', 'CLOUD_KITCHEN', 'SUPERMARKET', 'KIRANA', 'GROCERY', 'PHARMACY_RETAIL', 'PHARMACY_CHAIN', 'PHARMACY_HOSPITAL',
  'DIAGNOSTIC_LAB', 'DIAGNOSTIC_CHAIN', 'HOSPITAL_LAB',
  'BAKERY', 'MEAT_FISH', 'FLOWER', 'ELECTRONICS', 'CLOTHING', 'BEAUTY_WELLNESS', 'HOUSEHOLD_LIFESTYLE', 'BABY_CARE', 'PET_CARE',
  'PRINTING', 'STREET_VENDOR', 'SOCIETY_VENDOR', 'OTHER',
] as const;

const startSchema = z.object({
  storeType: z.enum(STORE_TYPES),
  businessName: z.string().trim().min(2).max(80),
  channel: z.enum(['WEB', 'MOBILE']).default('WEB'),
  referralCode: z.string().trim().max(40).optional(),
});

const stepParam = z.enum(Object.keys(STEP_SCHEMAS) as [StepKey, ...StepKey[]]);

const presignSchema = z.object({
  contentType: z.string().max(100),
  size: z.number().int().positive(),
});

const DOCUMENT_TYPES = [
  'FSSAI', 'GSTIN', 'PAN', 'DRUG_LICENSE_DL20', 'DRUG_LICENSE_DL21', 'PHARMACIST_REGISTRATION', 'ADDRESS_PROOF', 'BANK_PROOF',
  'NABL_CERTIFICATE', 'CLINICAL_ESTABLISHMENT_REG', 'PATHOLOGIST_REGISTRATION',
  'SHOP_ESTABLISHMENT', 'TRADE_LICENSE', 'LANDMARK_PHOTO', 'OTHER',
] as const;

const documentSchema = z.object({
  type: z.enum(DOCUMENT_TYPES),
  fileKey: z.string().min(10).max(300),
  documentNumber: z.string().trim().max(40).optional(),
  issuedAt: z.coerce.date().optional(),
  expiresAt: z.coerce.date().optional(),
  /** What the partner's browser read off the file (digital PDF text or OCR) — a hint for the reviewer. */
  reading: z
    .object({
      method: z.enum(['pdf-text', 'ocr']),
      documentNumber: z.string().trim().max(40).nullable(),
      issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      expiresAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
      confidence: z.enum(['HIGH', 'LOW', 'NONE']),
      engineConfidence: z.number().min(0).max(100).nullable(),
    })
    .optional(),
});

const bankSchema = z
  .object({
    accountHolderName: z.string().trim().min(2).max(120),
    accountNumber: z
      .string()
      .trim()
      .regex(/^\d{9,18}$/, 'Account number should be 9–18 digits')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    confirmAccountNumber: z.string().trim().optional(),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'IFSC looks wrong (e.g. HDFC0001234)')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    bankName: z.string().trim().max(80).optional(),
    upiId: z
      .string()
      .trim()
      .regex(/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/, 'UPI ID looks wrong (e.g. name@okhdfcbank)')
      .optional()
      .or(z.literal('').transform(() => undefined)),
  })
  .refine((b) => !b.accountNumber || b.accountNumber === b.confirmAccountNumber, {
    message: 'Account numbers do not match',
    path: ['confirmAccountNumber'],
  });

@ApiTags('onboarding')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('partners')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly documents: DocumentsService,
    private readonly bank: BankService,
  ) {}

  /** Start a new store registration (also used by owners adding another outlet). */
  @Post('onboarding')
  start(@Body(new ZodValidationPipe(startSchema)) body: z.infer<typeof startSchema>, @CurrentUser() user: AuthUser, @Req() req: ApiRequest) {
    return this.onboarding.start(body, actorOf(user, req, body.channel));
  }

  @Get('stores/:storeId/onboarding')
  @PartnerRoles('OWNER', 'MANAGER')
  view(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.onboarding.view(storeId);
  }

  @Patch('stores/:storeId/onboarding/steps/:step')
  @PartnerRoles('OWNER', 'MANAGER')
  saveStep(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Param('step', new ZodValidationPipe(stepParam)) step: StepKey,
    @Body() body: unknown,
    @CurrentUser() user: AuthUser,
    @Req() req: ApiRequest,
  ) {
    return this.onboarding.saveStep(storeId, step, body, actorOf(user, req));
  }

  @Post('stores/:storeId/onboarding/steps/:step/skip')
  @HttpCode(200)
  @PartnerRoles('OWNER', 'MANAGER')
  skipStep(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('step', new ZodValidationPipe(stepParam)) step: StepKey) {
    return this.onboarding.skipStep(storeId, step);
  }

  @Post('stores/:storeId/onboarding/submit')
  @HttpCode(200)
  @PartnerRoles('OWNER')
  submit(@Param('storeId', ParseUUIDPipe) storeId: string, @CurrentUser() user: AuthUser, @Req() req: ApiRequest) {
    return this.onboarding.submit(storeId, actorOf(user, req));
  }

  @Delete('stores/:storeId/onboarding/products/:productId')
  @PartnerRoles('OWNER', 'MANAGER')
  removeProduct(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('productId', ParseUUIDPipe) productId: string) {
    return this.onboarding.removeProduct(storeId, productId);
  }

  // Documents ---------------------------------------------------------

  @Post('stores/:storeId/uploads')
  @PartnerRoles('OWNER', 'MANAGER')
  presign(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(presignSchema)) body: z.infer<typeof presignSchema>) {
    return this.documents.presign(storeId, body.contentType, body.size);
  }

  @Post('stores/:storeId/documents')
  @PartnerRoles('OWNER', 'MANAGER')
  registerDocument(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body(new ZodValidationPipe(documentSchema)) body: z.infer<typeof documentSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: ApiRequest,
  ) {
    return this.documents.register(storeId, body, { ...actorOf(user, req), channel: 'WEB' });
  }

  @Get('stores/:storeId/documents')
  @PartnerRoles('OWNER', 'MANAGER', 'ACCOUNTANT')
  listDocuments(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.documents.list(storeId);
  }

  // Bank --------------------------------------------------------------

  @Put('stores/:storeId/bank-account')
  @PartnerRoles('OWNER')
  saveBank(
    @Param('storeId', ParseUUIDPipe) storeId: string,
    @Body(new ZodValidationPipe(bankSchema)) body: z.infer<typeof bankSchema>,
    @CurrentUser() user: AuthUser,
    @Req() req: ApiRequest,
  ) {
    return this.bank.save(storeId, body, actorOf(user, req));
  }
}

function actorOf(user: AuthUser, req: ApiRequest, channel?: OnboardingChannel): Actor {
  return { userId: user.userId, ip: req.ip, userAgent: req.header('user-agent'), correlationId: req.correlationId, channel };
}
