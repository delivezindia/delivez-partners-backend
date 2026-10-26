import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import type { AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { Apps, CurrentUser, Public } from '../identity/auth.decorators';
import { LocalAccountService } from './local-account.service';
import { LocalStoresService } from './local-stores.service';
import { LocalOrdersService } from './local-orders.service';
import { OrdersModule } from '../orders/orders.module';
import { RequireIdempotency } from '../../common/idempotency.interceptor';

const VERTICALS = ['EAT', 'GROCERY', 'PHARMACY', 'DIAGNOSTICS', 'LOCAL_STORES'] as const;
const lat = z.coerce.number().min(6).max(38);
const lng = z.coerce.number().min(68).max(98);
const nearbyQuery = z.object({ lat, lng, vertical: z.enum(VERTICALS).optional(), q: z.string().trim().min(2).max(60).optional() });
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
  contactPhone: z.string().trim().regex(/^\+?\d{10,13}$/, 'Enter a valid phone number').optional(),
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
  fulfilmentType: z.enum(['DELIVERY', 'PICKUP']),
  addressId: z.string().uuid().optional(),
  items: z.array(itemSchema).min(1, 'Your cart is empty').max(50),
});
const checkoutSchema = quoteSchema.extend({
  // Online payment arrives with Razorpay (L5).
  paymentMode: z.literal('COD'),
  note: z.string().trim().max(300).optional(),
});
const cancelSchema = z.object({ reason: z.string().trim().max(200).optional() });

/** Browsing — no login needed. */
@ApiTags('local')
@Public()
@Controller('local/stores')
export class LocalStoresController {
  constructor(private readonly stores: LocalStoresService) {}

  @Get()
  nearby(@Query(new ZodValidationPipe(nearbyQuery)) q: z.infer<typeof nearbyQuery>) {
    return this.stores.nearby(q);
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
  add(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(addressSchema)) b: z.infer<typeof addressSchema>) {
    return this.account.addAddress(u.userId, b);
  }

  @Put('addresses/:id')
  update2(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(addressSchema)) b: z.infer<typeof addressSchema>) {
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
  place(@CurrentUser() u: AuthUser, @Body(new ZodValidationPipe(checkoutSchema)) b: z.infer<typeof checkoutSchema>) {
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

  @Post('orders/:id/cancel')
  cancel(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(cancelSchema)) b: z.infer<typeof cancelSchema>) {
    return this.orders.cancel(u.userId, id, b.reason);
  }
}

@Module({
  imports: [OrdersModule],
  controllers: [LocalStoresController, LocalAccountController, LocalOrdersController],
  providers: [LocalStoresService, LocalAccountService, LocalOrdersService],
  exports: [LocalAccountService],
})
export class LocalModule {}
