import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiParam, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { ApiRequest, AuthUser } from '../../common/request-context';
import { zodToJsonSchema } from '../../common/zod-openapi';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { ApiError } from '../../common/api-exception.filter';
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES } from '../files/storage.service';
import { Apps, CurrentUser, Public } from '../identity/auth.decorators';
import { RIDER_OPTIONS, STEP_NAMES, STEPS, type StepName } from './rider-options';
import { RiderRegistrationService } from './rider-registration.service';

const docType = z.enum(['PHOTO', 'DRIVING_LICENCE', 'VEHICLE_RC', 'VEHICLE_INSURANCE', 'BANK_PROOF']);
const presignSchema = z.object({
  type: docType,
  contentType: z.enum(Object.keys(ALLOWED_UPLOAD_TYPES) as [string, ...string[]], { errorMap: () => ({ message: 'Upload a JPG, PNG, WEBP or PDF file' }) }),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, 'Files must be 10 MB or smaller'),
});
const attachSchema = z.object({ type: docType, fileKey: z.string().min(10).max(200) });
const submitSchema = z.object({ consent: z.literal(true, { errorMap: () => ({ message: 'Please confirm accuracy and consent to continue.' }) }) });

/**
 * Delivery partner app (Delivez Agent): sign-up after OTP login.
 * Login / refresh / logout use /v1/auth/* with app "RIDER"; then GET /v1/rider/me says which screen to open.
 */
@ApiTags('rider')
@ApiBearerAuth()
@Apps('RIDER')
@Controller('rider')
export class RidersController {
  constructor(private readonly reg: RiderRegistrationService) {}

  /** next = REGISTER (fill / fix the application) · STATUS (with ops, or rejected) · HOME (approved) · RESTRICTED (suspended). */
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.reg.me(user.userId);
  }

  /** Dropdown choices, declarations and training modules for every step. */
  @Public()
  @Get('registration/options')
  options() {
    return { ...RIDER_OPTIONS, steps: STEP_NAMES };
  }

  @Post('registration')
  @HttpCode(200)
  start(@CurrentUser() user: AuthUser) {
    return this.reg.start(user.userId);
  }

  @Get('registration')
  get(@CurrentUser() user: AuthUser) {
    return this.reg.get(user.userId);
  }

  /** Saves one step: personal-info, legal-vehicle, work-tech, hyperlocal, training-role or safety-compliance. */
  @ApiParam({ name: 'step', enum: STEP_NAMES })
  @ApiBody({
    description: 'The body depends on :step, one of these (in the same order as the step list).',
    schema: { oneOf: STEP_NAMES.map((name) => ({ title: name, ...zodToJsonSchema(STEPS[name].schema) })) },
  })
  @Put('registration/steps/:step')
  saveStep(@CurrentUser() user: AuthUser, @Param('step') step: string, @Body() body: unknown) {
    if (!(STEP_NAMES as string[]).includes(step)) throw new ApiError(404, 'STEP_NOT_FOUND', `Unknown step. Use one of: ${STEP_NAMES.join(', ')}`);
    return this.reg.saveStep(user.userId, step as StepName, body);
  }

  /** 1) Ask for an upload link, 2) PUT the file to uploadUrl, 3) POST registration/documents with the fileKey. */
  @Post('registration/documents/presign')
  @HttpCode(200)
  presign(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(presignSchema)) body: z.infer<typeof presignSchema>) {
    return this.reg.presignDocument(user.userId, body.type, body.contentType, body.size);
  }

  @Post('registration/documents')
  @HttpCode(200)
  attach(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(attachSchema)) body: z.infer<typeof attachSchema>) {
    return this.reg.attachDocument(user.userId, body.type, body.fileKey);
  }

  @Delete('registration/documents/:type')
  remove(@CurrentUser() user: AuthUser, @Param('type', new ZodValidationPipe(docType)) type: z.infer<typeof docType>) {
    return this.reg.removeDocument(user.userId, type);
  }

  @Post('registration/submit')
  @HttpCode(200)
  submit(@CurrentUser() user: AuthUser, @Body(new ZodValidationPipe(submitSchema)) _body: z.infer<typeof submitSchema>, @Req() req: ApiRequest) {
    return this.reg.submit(user.userId, req.ip);
  }
}
