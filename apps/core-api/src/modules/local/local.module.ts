import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps, CurrentUser, Public } from '../identity/auth.decorators';
import { LocalAccountService } from './local-account.service';
import { LocalOverviewService } from './local-overview.service';
import { LocalStoresService } from './local-stores.service';
import { LocalOrdersService, ONLINE_METHODS } from './local-orders.service';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { RequireIdempotency } from '../../common/idempotency.interceptor';
import { LabBookingsModule } from '../lab-bookings/lab-bookings.module';
import { SupportModule } from '../support/support.module';
import { CouponsModule } from '../coupons/coupons.module';
import { CUSTOMER_CATEGORIES, SupportService } from '../support/support.service';
import { RETURN_REASONS } from '../orders/returns-rules';
import { LocalLabPaymentsService } from './local-lab-payments.service';
import { LocalLabsService } from './local-labs.service';
import { REVIEW_TAGS } from './local-orders.service';

const VERTICALS = ['EAT', 'GROCERY', 'PHARMACY', 'DIAGNOSTICS', 'LOCAL_STORES'] as const;
const lat = z.coerce.number().min(6).max(38);
const lng = z.coerce.number().min(68).max(98);
const nearbyQuery = z.object({
  lat,
  lng,
  vertical: z.enum(VERTICALS).optional(),
  q: z.string().trim().min(2).max(60).optional(),
});
const menuQuery = z.object({ lat: lat.optional(), lng: lng.optional() });
const meSchema = z.object({
  fullName: z.string().trim().min(2).max(80).optional(),
  email: z.string().trim().email().max(120).nullable().optional(),
  whatsappOptIn: z.boolean().optional(),
  marketingOptIn: z.boolean().optional(),
});
const addressSchema = z.object({
  label: z.enum(['HOME', 'WORK', 'OTHER']).default('HOME'),
  contactName: z.string().trim().max(80).optional(),
  contactPhone: z
    .string()
    .trim()
    .regex(/^\+?\d{10,13}$/, 'Enter a valid phone number')
    .optional(),
  line1: z.string().trim().min(3, 'Enter the house / flat and street').max(160),
  line2: z.string().trim().max(160).optional(),
  landmark: z.string().trim().max(120).optional(),
  pincode: z.string().regex(/^\d{6}$/, 'Enter the 6-digit PIN code'),
  cityName: z.string().trim().min(2).max(80),
  state: z.string().trim().min(2).max(80),
  lat,
  lng,
  placeId: z.string().max(300).optional(),
  isDefault: z.boolean().optional(),
});

const itemSchema = z.object({
  productId: z.string().uuid(),
  qty: z.number().int().min(1).max(50),
  variantId: z.string().uuid().optional(),
  addonIds: z.array(z.string().uuid()).max(20).optional(),
});
const quoteSchema = z.object({
  storeId: z.string().uuid(),
  // Home delivery only — customers can't collect from the shop.
  fulfilmentType: z.literal('DELIVERY').default('DELIVERY'),
  addressId: z.string().uuid().optional(),
  items: z.array(itemSchema).min(1, 'Your cart is empty').max(50),
  prescriptionFileKeys: z.array(z.string().max(200)).max(5).optional(),
  couponCode: z.string().trim().max(20).regex(/^[A-Za-z0-9]*$/, 'Letters and numbers only').optional().transform((v) => v || undefined),
});
const checkoutSchema = quoteSchema.extend({
  // Online only — no cash on delivery for app orders.
  paymentMode: z.enum(ONLINE_METHODS),
  note: z.string().trim().max(300).optional(),
});
const verifySchema = z.object({ razorpay_order_id: z.string().min(5).max(64), razorpay_payment_id: z.string().min(5).max(64), razorpay_signature: z.string().min(16).max(256) });
const cancelSchema = z.object({
  reason: z.string().trim().max(200).optional(),
});
const uploadSchema = z.object({ contentType: z.enum(['application/pdf', 'image/jpeg', 'image/png', 'image/webp']), size: z.number().int().positive().max(10 * 1024 * 1024) });
const subAnswerSchema = z.object({ accept: z.boolean() });
const returnSchema = z.object({
  items: z.array(z.object({ itemId: z.string().uuid(), qty: z.number().int().min(1).max(50), reason: z.enum(RETURN_REASONS) })).min(1, 'Pick at least one item').max(50),
  note: z.string().trim().max(300).optional(),
});
const reviewSchema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional(), tags: z.array(z.enum(REVIEW_TAGS)).max(8).optional() });
const slotsQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), type: z.enum(['HOME', 'WALK_IN']) });
const labBookSchema = z
  .object({
    storeId: z.string().uuid(),
    collectionType: z.enum(['HOME', 'WALK_IN']),
    slotStart: z.coerce.date(),
    testIds: z.array(z.string().uuid()).min(1, 'Pick at least one test').max(30),
    patient: z.object({ name: z.string().trim().min(2, 'Enter the patient’s name').max(80), age: z.number().int().min(0).max(120).optional(), gender: z.enum(['F', 'M', 'O']).optional() }),
    addressId: z.string().uuid().optional(),
    note: z.string().trim().max(300).optional(),
    prescriptionFileKeys: z.array(z.string().max(200)).max(5).optional(),
    paymentMode: z.enum(['COD', 'UPI', 'CARD', 'NETBANKING']).optional(),
  })
  .refine((v) => v.collectionType !== 'HOME' || !!v.addressId, { message: 'Choose the address for sample collection', path: ['addressId'] });
const rescheduleSchema = z.object({ slotStart: z.coerce.date() });
const ticketSchema = z.object({
  category: z.enum(CUSTOMER_CATEGORIES),
  subject: z.string().trim().min(3, 'Add a short title').max(120),
  message: z.string().trim().min(5, 'Tell us a little more').max(2000),
  orderId: z.string().uuid().optional(),
});
const replySchema = z.object({ body: z.string().trim().min(1).max(2000) });

/** The public page: live cities, shops per kind, and "do you deliver to my PIN?" — no login needed. */
@ApiTags('local')
@Public()
@Controller('local')
export class LocalOverviewController {
  constructor(private readonly overview: LocalOverviewService) {}

  @Get('overview')
  get() {
    return this.overview.overview();
  }

  @Get('serviceable/:pincode')
  serviceable(@Param('pincode', new ZodValidationPipe(z.string().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit PIN code'))) pincode: string) {
    return this.overview.serviceable(pincode);
  }
}

/** Browsing — no login needed. */
@ApiTags('local')
@Public()
@Controller('local/stores')
export class LocalStoresController {
  constructor(
    private readonly stores: LocalStoresService,
    private readonly labs: LocalLabsService,
  ) {}

  @Get()
  nearby(@Query(new ZodValidationPipe(nearbyQuery)) q: z.infer<typeof nearbyQuery>) {
    return this.stores.nearby(q);
  }

  /** Hourly slots at a lab (home collection or walk-in) for one day. */
  @Get(':idOrSlug/lab-slots')
  labSlots(@Param('idOrSlug') idOrSlug: string, @Query(new ZodValidationPipe(slotsQuery)) q: z.infer<typeof slotsQuery>) {
    return this.labs.slots(idOrSlug, q.date, q.type);
  }

  @Get(':idOrSlug')
  menu(@Param('idOrSlug') idOrSlug: string, @Query(new ZodValidationPipe(menuQuery)) q: z.infer<typeof menuQuery>) {
    return this.stores.menu(idOrSlug, q.lat != null && q.lng != null ? { lat: q.lat, lng: q.lng } : undefined);
  }
}

/** The signed-in customer: profile and saved addresses. */
@ApiTags('local')
@ApiBearerAuth()
@Apps('LOCAL')
@Controller('local/me')
export class LocalAccountController {
  constructor(private readonly account: LocalAccountService) {}

  @Get()
  me(@CurrentUser() u: AuthUser) {
    return this.account.me(u.userId);
  }

  @Patch()
  update(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(meSchema)) b: z.infer<typeof meSchema>) {
    return this.account.updateMe(u.userId, b);
  }

  @Get('addresses')
  addresses(@CurrentUser() u: AuthUser) {
    return this.account.addresses(u.userId);
  }

  @Post('addresses')
  add(
    @CurrentUser() u: AuthUser,
    @Body(new ZodValidationPipe(addressSchema))
    b: z.infer<typeof addressSchema>,
  ) {
    return this.account.addAddress(u.userId, b);
  }

  @Put('addresses/:id')
  update2(
    @CurrentUser() u: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addressSchema))
    b: z.infer<typeof addressSchema>,
  ) {
    return this.account.updateAddress(u.userId, id, b);
  }

  @Delete('addresses/:id')
  remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.account.removeAddress(u.userId, id);
  }
}

/** The signed-in customer's basket and orders. */
@ApiTags('local')
@ApiBearerAuth()
@Apps('LOCAL')
@Controller('local')
export class LocalOrdersController {
  constructor(private readonly orders: LocalOrdersService) {}

  @Post('cart/quote')
  quote(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(quoteSchema)) b: z.infer<typeof quoteSchema>) {
    return this.orders.quote(u.userId, b);
  }

  @Post('orders')
  @RequireIdempotency()
  place(
    @CurrentUser() u: AuthUser,
    @Body(new ZodValidationPipe(checkoutSchema))
    b: z.infer<typeof checkoutSchema>,
  ) {
    return this.orders.place(u.userId, b);
  }

  @Get('orders')
  list(@CurrentUser() u: AuthUser, @Query('cursor') cursor?: string) {
    return this.orders.list(u.userId, cursor && /^[0-9a-f-]{36}$/i.test(cursor) ? cursor : undefined);
  }

  @Get('orders/:id')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.orders.detail(u.userId, id);
  }

  @Post('orders/:id/payment')
  payment(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.payment(u.userId, id);
  }

  @Post('orders/:id/payment/verify')
  verify(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(verifySchema)) b: z.infer<typeof verifySchema>) {
    return this.orders.verifyPayment(u.userId, id, b);
  }

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(cancelSchema)) b: z.infer<typeof cancelSchema>) {
    return this.orders.cancel(u.userId, id, b.reason);
  }

  /** Upload link for a prescription (pharmacy orders). */
  @Post('pharmacies/:storeId/rx-upload')
  rxUpload(@CurrentUser() u: AuthUser, @Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(uploadSchema)) b: z.infer<typeof uploadSchema>) {
    return this.orders.rxUpload(u.userId, storeId, b.contentType, b.size);
  }

  @Post('orders/:id/substitutions/:subId')
  @HttpCode(200)
  substitution(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('subId', ParseUUIDPipe) subId: string, @Body(new ZodValidationPipe(subAnswerSchema)) b: z.infer<typeof subAnswerSchema>) {
    return this.orders.respondSubstitution(u.userId, id, subId, b.accept);
  }

  @Post('orders/:id/returns')
  @RequireIdempotency()
  returnItems(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(returnSchema)) b: z.infer<typeof returnSchema>) {
    return this.orders.returnItems(u.userId, id, b.items, b.note);
  }

  @Post('orders/:id/returns/keep')
  @HttpCode(200)
  keepAll(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.keepAll(u.userId, id);
  }

  @Post('orders/:id/review')
  review(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(reviewSchema)) b: z.infer<typeof reviewSchema>) {
    return this.orders.review(u.userId, id, b);
  }
}

/** Lab tests: book a slot, track it, open the report. */
@ApiTags('local')
@ApiBearerAuth()
@Apps('LOCAL')
@Controller('local')
export class LocalLabsController {
  constructor(private readonly labs: LocalLabsService) {}

  @Post('labs/:storeId/rx-upload')
  rxUpload(@CurrentUser() u: AuthUser, @Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(uploadSchema)) b: z.infer<typeof uploadSchema>) {
    return this.labs.rxUpload(u.userId, storeId, b.contentType, b.size);
  }

  @Post('lab-bookings')
  @RequireIdempotency()
  book(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(labBookSchema)) b: z.infer<typeof labBookSchema>) {
    return this.labs.book(u.userId, b);
  }

  @Post('lab-bookings/payments/:paymentId/verify')
  @HttpCode(200)
  verifyLabPayment(@CurrentUser() u: AuthUser, @Param('paymentId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(verifySchema)) b: z.infer<typeof verifySchema>) {
    return this.labs.verifyPayment(u.userId, id, b);
  }

  @Post('lab-bookings/payments/:paymentId/abandon')
  @HttpCode(200)
  abandonLabPayment(@CurrentUser() u: AuthUser, @Param('paymentId', ParseUUIDPipe) id: string) {
    return this.labs.abandonPayment(u.userId, id);
  }

  @Get('lab-bookings')
  list(@CurrentUser() u: AuthUser) {
    return this.labs.list(u.userId);
  }

  @Get('lab-bookings/:id')
  detail(@CurrentUser() u: AuthUser, @Param('id') id: string) {
    return this.labs.detail(u.userId, id);
  }

  @Post('lab-bookings/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(cancelSchema)) b: z.infer<typeof cancelSchema>) {
    return this.labs.cancel(u.userId, id, b.reason);
  }

  @Post('lab-bookings/:id/reschedule')
  @HttpCode(200)
  reschedule(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(rescheduleSchema)) b: z.infer<typeof rescheduleSchema>) {
    return this.labs.reschedule(u.userId, id, b.slotStart);
  }

  @Get('lab-bookings/:id/reports/:reportId')
  report(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('reportId', ParseUUIDPipe) reportId: string) {
    return this.labs.report(u.userId, id, reportId);
  }
}

/** Help: the customer's tickets with Delivez support. */
@ApiTags('local')
@ApiBearerAuth()
@Apps('LOCAL')
@Controller('local/support')
export class LocalSupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  list(@CurrentUser() u: AuthUser) {
    return this.support.customerList(u.userId);
  }

  @Post()
  @RequireIdempotency()
  create(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(ticketSchema)) b: z.infer<typeof ticketSchema>) {
    return this.support.customerCreate(u.userId, b);
  }

  @Get(':id')
  get(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.customerGet(u.userId, id);
  }

  @Post(':id/reply')
  @HttpCode(200)
  reply(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(replySchema)) b: z.infer<typeof replySchema>) {
    return this.support.customerReply(u.userId, id, b.body);
  }

  @Post(':id/resolve')
  @HttpCode(200)
  resolve(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.customerResolve(u.userId, id);
  }
}

@Module({
  imports: [OrdersModule, PaymentsModule, LabBookingsModule, SupportModule, CouponsModule],
  controllers: [LocalOverviewController, LocalStoresController, LocalAccountController, LocalOrdersController, LocalLabsController, LocalSupportController],
  providers: [LocalOverviewService, LocalStoresService, LocalAccountService, LocalOrdersService, LocalLabsService, LocalLabPaymentsService],
  exports: [LocalAccountService],
})
export class LocalModule {}
