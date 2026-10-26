import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiError } from '../../common/api-exception.filter';
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
import { DispatchService, TASK_STEPS } from './dispatch.service';
import { OrderStateService, type OrderActor } from './order-state.service';
import { OrdersService, type OrderTab } from './orders.service';
import { SimulatorService } from './simulator.service';
import { SubstitutionsService } from './substitutions.service';
import { ReturnsService } from './returns.service';
import { RETURN_REASONS } from './returns-rules';

// Who can do what on the order screen (plan §4.2 role model).
const VIEW = ['OWNER', 'MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST'] as const;
const KITCHEN = ['OWNER', 'MANAGER', 'KITCHEN_LEAD', 'PHARMACIST'] as const;
const COUNTER = ['OWNER', 'MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST'] as const;
const CREATE = ['OWNER', 'MANAGER', 'COUNTER_STAFF'] as const;

export const REJECT_REASONS = ['ITEMS_UNAVAILABLE', 'TOO_BUSY', 'STORE_CLOSING', 'KITCHEN_ISSUE', 'OTHER'] as const;
const REJECT_TEXT: Record<(typeof REJECT_REASONS)[number], string> = {
  ITEMS_UNAVAILABLE: 'Items unavailable',
  TOO_BUSY: 'Store too busy',
  STORE_CLOSING: 'Store closing',
  KITCHEN_ISSUE: 'Kitchen / equipment issue',
  OTHER: 'Other',
};

const listQuery = z.object({
  tab: z.enum(['RX', 'NEW', 'PREPARING', 'READY', 'DONE', 'CANCELLED', 'ALL']).default('NEW'),
  cursor: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
const acceptSchema = z.object({ prepMinutes: z.number().int().min(5).max(120).optional() });
const rejectSchema = z.object({ reason: z.enum(REJECT_REASONS), note: z.string().trim().max(200).optional() }).refine((v) => v.reason !== 'OTHER' || !!v.note, { message: 'Tell us why', path: ['note'] });
const readySoonSchema = z.object({ windowMinutes: z.union([z.literal(5), z.literal(10), z.literal(15)]) });
const delaySchema = z.object({ minutes: z.number().int().min(5).max(30), reason: z.string().trim().min(3).max(200) });
const handoverSchema = z.object({ otp: z.string().regex(/^\d{4}$/, 'Enter the 4-digit code').optional(), qr: z.string().max(200).optional() }).refine((v) => !!v.otp || !!v.qr, { message: 'Enter the rider’s code or scan the QR', path: ['otp'] });
const pickupSchema = z.object({ otp: z.string().regex(/^\d{4}$/, 'Enter the 4-digit code') });
const unavailableSchema = z.object({ switchOff: z.boolean().default(false) });
const substituteSchema = z.object({ productId: z.string().uuid(), variantId: z.string().uuid().optional(), qty: z.number().int().min(1).max(50), note: z.string().trim().max(200).optional() });
const respondSchema = z.object({ accept: z.boolean() });
const returnSchema = z.object({ items: z.array(z.object({ itemId: z.string().uuid(), qty: z.number().int().min(1).max(50), reason: z.enum(RETURN_REASONS) })).min(1).max(50), note: z.string().trim().max(200).optional() });
const receiveSchema = z.object({ restock: z.boolean() });
const itemSchema = z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(50), variantId: z.string().uuid().optional(), addonIds: z.array(z.string().uuid()).max(20).optional() });
const createSchema = z
  .object({
    customer: z.object({ phone: indianPhone, name: z.string().trim().min(2).max(80).optional() }),
    fulfilmentType: z.enum(['DELIVERY', 'PICKUP']),
    address: z.object({ line1: z.string().trim().min(3).max(160), landmark: z.string().trim().max(120).optional(), pincode: z.string().regex(/^\d{6}$/), lat: z.number().min(6).max(38), lng: z.number().min(68).max(98) }).optional(),
    items: z.array(itemSchema).min(1).max(50),
    paymentMode: z.enum(['COD', 'UPI']),
    prepMinutes: z.number().int().min(5).max(120).optional(),
    note: z.string().trim().max(300).optional(),
    /** Pharmacy: a pharmacist has checked the customer’s paper prescription for Schedule H/H1 items. */
    rxSeenByStore: z.boolean().optional(),
  })
  .refine((v) => v.fulfilmentType === 'PICKUP' || !!v.address, { message: 'Add the delivery address', path: ['address'] });
const simulateSchema = z.object({
  count: z.number().int().min(1).max(5).default(1),
  fulfilment: z.enum(['DELIVERY', 'PICKUP', 'ANY']).default('ANY'),
  payment: z.enum(['COD', 'UPI', 'ANY']).default('ANY'),
  placedSecondsAgo: z.number().int().min(0).max(1200).default(0),
  /** Pharmacy: YES adds a prescription medicine and a sample prescription (needs a pharmacist on duty). */
  rx: z.enum(['YES', 'NO']).default('NO'),
});

const partnerActor = (u: AuthUser, s: StoreAccess, r: ApiRequest): OrderActor => ({ kind: 'PARTNER', userId: u.userId, role: s.role, correlationId: r.correlationId });

@ApiTags('orders')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('partners/stores/:storeId/orders')
export class PartnerOrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly state: OrderStateService,
    private readonly substitutions: SubstitutionsService,
    private readonly returns: ReturnsService,
  ) {}

  @Get()
  @PartnerRoles(...VIEW)
  list(@Param('storeId', ParseUUIDPipe) storeId: string, @Query(new ZodValidationPipe(listQuery)) q: z.infer<typeof listQuery>) {
    return this.orders.list(storeId, q.tab as OrderTab, q.cursor, q.limit);
  }

  @Get(':idOrNumber')
  @PartnerRoles(...VIEW)
  detail(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('idOrNumber') idOrNumber: string) {
    return this.orders.detail(storeId, idOrNumber);
  }

  /** Phone / walk-in orders the store enters itself (channel PARTNER_MANUAL, starts accepted). */
  @Post()
  @RequireIdempotency()
  @PartnerRoles(...CREATE)
  create(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(createSchema)) b: z.infer<typeof createSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.orders.create(
      { storeId, channel: 'PARTNER_MANUAL', fulfilmentType: b.fulfilmentType, customer: b.customer, items: b.items, paymentMode: b.paymentMode, address: b.address, note: b.note, rxSeenByStore: b.rxSeenByStore, startAccepted: { prepMinutes: b.prepMinutes } },
      partnerActor(u, s, r),
    );
  }

  @Post(':orderId/accept')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...KITCHEN)
  async accept(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body(new ZodValidationPipe(acceptSchema)) b: z.infer<typeof acceptSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    await this.orders.mustOwn(storeId, orderId);
    await this.state.transition(orderId, 'ACCEPT', partnerActor(u, s, r), { prepMinutes: b.prepMinutes });
    return this.orders.detailById(orderId);
  }

  @Post(':orderId/reject')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...KITCHEN)
  async reject(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body(new ZodValidationPipe(rejectSchema)) b: z.infer<typeof rejectSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    await this.orders.mustOwn(storeId, orderId);
    const reason = b.note ? `${REJECT_TEXT[b.reason]}: ${b.note}` : REJECT_TEXT[b.reason];
    await this.state.transition(orderId, 'REJECT', partnerActor(u, s, r), { reason, meta: { code: b.reason } });
    return this.orders.detailById(orderId);
  }

  @Post(':orderId/preparing')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...KITCHEN)
  async preparing(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    await this.orders.mustOwn(storeId, orderId);
    await this.state.transition(orderId, 'START_PREPARING', partnerActor(u, s, r));
    return this.orders.detailById(orderId);
  }

  @Post(':orderId/ready-soon')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...KITCHEN)
  async readySoon(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body(new ZodValidationPipe(readySoonSchema)) b: z.infer<typeof readySoonSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    await this.orders.mustOwn(storeId, orderId);
    await this.state.transition(orderId, 'READY_SOON', partnerActor(u, s, r), { windowMinutes: b.windowMinutes });
    return this.orders.detailById(orderId);
  }

  @Post(':orderId/ready')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...COUNTER)
  async ready(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    await this.orders.mustOwn(storeId, orderId);
    await this.state.transition(orderId, 'MARK_READY', partnerActor(u, s, r));
    return this.orders.detailById(orderId);
  }

  @Post(':orderId/delay')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...KITCHEN)
  delay(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body(new ZodValidationPipe(delaySchema)) b: z.infer<typeof delaySchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.orders.delay(storeId, orderId, b.minutes, b.reason, partnerActor(u, s, r));
  }

  @Post(':orderId/handover')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...COUNTER)
  handover(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body(new ZodValidationPipe(handoverSchema)) b: z.infer<typeof handoverSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.orders.handover(storeId, orderId, b, partnerActor(u, s, r));
  }

  @Post(':orderId/pickup-complete')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...COUNTER)
  pickup(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Body(new ZodValidationPipe(pickupSchema)) b: z.infer<typeof pickupSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.orders.pickupComplete(storeId, orderId, b.otp, partnerActor(u, s, r));
  }

  @Post(':orderId/items/:itemId/unavailable')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...COUNTER)
  unavailable(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodValidationPipe(unavailableSchema)) b: z.infer<typeof unavailableSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.orders.itemUnavailable(storeId, orderId, itemId, b.switchOff, partnerActor(u, s, r));
  }

  /** Grocery: offer a replacement for an item that ran out; the customer has 5 minutes to answer. */
  @Post(':orderId/items/:itemId/substitute')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...COUNTER)
  substitute(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Param('itemId', ParseUUIDPipe) itemId: string, @Body(new ZodValidationPipe(substituteSchema)) b: z.infer<typeof substituteSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.substitutions.propose(storeId, orderId, itemId, b, partnerActor(u, s, r));
  }

  /** Returned items are back at the shop: on the shelf again, or damaged. */
  @Post(':orderId/returns/:returnId/receive')
  @HttpCode(200)
  @RequireIdempotency()
  @PartnerRoles(...COUNTER)
  receive(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Param('returnId', ParseUUIDPipe) returnId: string, @Body(new ZodValidationPipe(receiveSchema)) b: z.infer<typeof receiveSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.returns.receive(storeId, orderId, returnId, b.restock, partnerActor(u, s, r));
  }
}

/** Dev order simulator — never available in production. */
@ApiTags('orders')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('dev/stores/:storeId/orders')
export class DevOrdersController {
  constructor(
    private readonly simulator: SimulatorService,
    private readonly substitutions: SubstitutionsService,
    private readonly orders: OrdersService,
  ) {}

  /** Plays the customer answering a substitute until the Local app exists. */
  @Post(':orderId/substitutions/:subId/respond')
  @HttpCode(200)
  @PartnerRoles('OWNER', 'MANAGER', 'COUNTER_STAFF')
  async respond(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('orderId', ParseUUIDPipe) orderId: string, @Param('subId', ParseUUIDPipe) subId: string, @Body(new ZodValidationPipe(respondSchema)) b: z.infer<typeof respondSchema>, @CurrentUser() u: AuthUser) {
    if (process.env.NODE_ENV === 'production') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND', 'Not found');
    await this.orders.mustOwn(storeId, orderId);
    return this.substitutions.respond(orderId, subId, b.accept, { kind: 'CUSTOMER', userId: u.userId });
  }

  @Post('simulate')
  @PartnerRoles('OWNER', 'MANAGER')
  simulate(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(simulateSchema)) b: z.infer<typeof simulateSchema>, @CurrentUser() u: AuthUser, @CurrentStore() s: StoreAccess, @Req() r: ApiRequest) {
    return this.simulator.simulate(storeId, b, { kind: 'CUSTOMER', userId: u.userId, role: s.role, correlationId: r.correlationId });
  }
}

const adminListQuery = z.object({
  storeId: z.string().uuid().optional(),
  status: z.string().max(30).optional(),
  q: z.string().trim().max(20).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().datetime().optional(),
});
const adminCancelSchema = z.object({ reason: z.string().trim().min(5).max(300) });
const taskStepSchema = z.object({ status: z.enum(TASK_STEPS), reason: z.string().trim().max(200).optional() });
const adminActor = (a: AdminContext, r: ApiRequest): OrderActor => ({ kind: 'ADMIN', userId: a.userId, role: a.role, correlationId: r.correlationId });
const ORDER_OPS = [...ROLES.OPERATE_STORES, 'SUPPORT' as const];

@ApiTags('admin')
@ApiBearerAuth()
@Apps('ADMIN')
@UseGuards(AdminGuard)
@Controller('admin')
export class AdminOrdersController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly returns: ReturnsService,
  ) {}

  /** Playing the rider at the door (until the rider app exists): items the customer handed back. */
  @Post('orders/:id/returns')
  @AdminRoles(...ROLES.OPERATE_STORES)
  async doorReturn(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(returnSchema)) b: z.infer<typeof returnSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    await this.dispatch.adminDetail(id, a.cityIds); // city scope
    await this.returns.create(id, b.items, b.note, adminActor(a, r));
    return this.dispatch.adminDetail(id, a.cityIds);
  }

  /** "Customer is happy" — the rider leaves. */
  @Post('orders/:id/return-window/close')
  @HttpCode(200)
  @AdminRoles(...ROLES.OPERATE_STORES)
  async closeWindow(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    await this.dispatch.adminDetail(id, a.cityIds);
    await this.returns.close(id, adminActor(a, r));
    return this.dispatch.adminDetail(id, a.cityIds);
  }

  @Get('orders')
  list(@Query(new ZodValidationPipe(adminListQuery)) q: z.infer<typeof adminListQuery>, @CurrentAdmin() a: AdminContext) {
    return this.dispatch.adminList(q, a.cityIds);
  }

  @Get('orders/:id')
  detail(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() a: AdminContext) {
    return this.dispatch.adminDetail(id, a.cityIds);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @AdminRoles(...ORDER_OPS)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(adminCancelSchema)) b: z.infer<typeof adminCancelSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.dispatch.cancel(id, b.reason, adminActor(a, r), a.cityIds);
  }

  @Post('tasks/:id/assign')
  @HttpCode(200)
  @AdminRoles(...ROLES.OPERATE_STORES)
  assign(@Param('id', ParseUUIDPipe) id: string, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.dispatch.assign(id, adminActor(a, r), a.cityIds);
  }

  @Post('tasks/:id/status')
  @HttpCode(200)
  @AdminRoles(...ROLES.OPERATE_STORES)
  step(@Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(taskStepSchema)) b: z.infer<typeof taskStepSchema>, @CurrentAdmin() a: AdminContext, @Req() r: ApiRequest) {
    return this.dispatch.step(id, b.status, b.reason, adminActor(a, r), a.cityIds);
  }
}
