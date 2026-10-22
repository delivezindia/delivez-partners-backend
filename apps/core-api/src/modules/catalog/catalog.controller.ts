import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiError } from '../../common/api-exception.filter';
import type { ApiRequest, AuthUser } from '../../common/request-context';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { Apps, CurrentUser } from '../identity/auth.decorators';
import type { Actor } from '../onboarding/onboarding.service';
import { PartnerRoles, StoreAccessGuard } from '../partners/store-access.guard';
import {
  availabilitySchema,
  bulkSchema,
  categorySchema,
  categoryUpdateSchema,
  importSchema,
  pauseSchema,
  productCreateSchema,
  productQuerySchema,
  productUpdateSchema,
  reorderSchema,
  stockChangeSchema,
} from './catalog.schemas';
import { CatalogService } from './catalog.service';
import { CSV_TEMPLATE, ImportService } from './import.service';
import { InventoryService } from './inventory.service';

const actorOf = (u: AuthUser, r: ApiRequest): Actor => ({ userId: u.userId, ip: r.ip, userAgent: r.header('user-agent'), correlationId: r.correlationId, channel: 'WEB' });

// Role groups (plan §4.2): managers edit the catalog; kitchen/counter only switch items on/off.
const VIEW = ['OWNER', 'MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST'] as const;
const EDIT = ['OWNER', 'MANAGER'] as const;
const TOGGLE = ['OWNER', 'MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST'] as const;
const STOCK = ['OWNER', 'MANAGER', 'PHARMACIST'] as const;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@ApiTags('catalog')
@ApiBearerAuth()
@Apps('PARTNERS')
@UseGuards(StoreAccessGuard)
@Controller('partners/stores/:storeId')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly inventory: InventoryService,
    private readonly importer: ImportService,
    private readonly storage: StorageService,
    private readonly prisma: PrismaService,
  ) {}

  // Categories -------------------------------------------------------

  @Get('categories')
  @PartnerRoles(...VIEW)
  categories(@Param('storeId', ParseUUIDPipe) storeId: string) {
    return this.catalog.categories(storeId);
  }

  @Post('categories')
  @PartnerRoles(...EDIT)
  createCategory(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(categorySchema)) b: z.infer<typeof categorySchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.catalog.createCategory(storeId, b, actorOf(u, r));
  }

  @Put('categories/order')
  @PartnerRoles(...EDIT)
  reorderCategories(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(reorderSchema)) b: z.infer<typeof reorderSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.catalog.reorderCategories(storeId, b.ids, actorOf(u, r));
  }

  @Patch('categories/:id')
  @PartnerRoles(...EDIT)
  updateCategory(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(categoryUpdateSchema)) b: z.infer<typeof categoryUpdateSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.catalog.updateCategory(storeId, id, b, actorOf(u, r));
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @PartnerRoles(...EDIT)
  async deleteCategory(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    await this.catalog.deleteCategory(storeId, id, actorOf(u, r));
  }

  // Products -----------------------------------------------------------

  @Get('products')
  @PartnerRoles(...VIEW)
  products(@Param('storeId', ParseUUIDPipe) storeId: string, @Query(new ZodValidationPipe(productQuerySchema)) q: z.infer<typeof productQuerySchema>) {
    return this.catalog.products(storeId, q);
  }

  @Post('products')
  @PartnerRoles(...EDIT)
  create(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(productCreateSchema)) b: z.infer<typeof productCreateSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.catalog.create(storeId, b, actorOf(u, r));
  }

  @Post('products/bulk')
  @HttpCode(200)
  @PartnerRoles(...EDIT)
  bulk(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(bulkSchema)) b: z.infer<typeof bulkSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.catalog.bulk(storeId, b, actorOf(u, r));
  }

  @Put('products/order')
  @PartnerRoles(...EDIT)
  reorderProducts(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(reorderSchema)) b: z.infer<typeof reorderSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.catalog.reorderProducts(storeId, b.ids, actorOf(u, r));
  }

  @Get('products/import/template.csv')
  @PartnerRoles(...EDIT)
  @Header('content-type', 'text/csv; charset=utf-8')
  @Header('content-disposition', 'attachment; filename="delivez-catalog-template.csv"')
  async template(@Param('storeId', ParseUUIDPipe) storeId: string) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { vertical: true } });
    return CSV_TEMPLATE[store.vertical];
  }

  @Post('products/import/preview')
  @HttpCode(200)
  @PartnerRoles(...EDIT)
  async importPreview(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(importSchema)) b: z.infer<typeof importSchema>) {
    const { _rows: _internal, ...preview } = (await this.importer.preview(storeId, b.csv, b.updateExisting)) as Record<string, unknown>;
    return preview;
  }

  @Post('products/import')
  @HttpCode(200)
  @PartnerRoles(...EDIT)
  importRun(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(importSchema)) b: z.infer<typeof importSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.importer.run(storeId, b.csv, b.updateExisting, actorOf(u, r));
  }

  @Post('products/uploads')
  @PartnerRoles(...EDIT)
  presignImage(@Param('storeId', ParseUUIDPipe) storeId: string, @Body(new ZodValidationPipe(z.object({ contentType: z.string(), size: z.number().int().positive() }))) b: { contentType: string; size: number }) {
    if (!IMAGE_TYPES.includes(b.contentType)) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_TYPE_NOT_ALLOWED', 'Upload a JPG, PNG or WEBP image');
    if (b.size > 5 * 1024 * 1024) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_TOO_LARGE', 'Images must be 5 MB or smaller');
    return this.storage.presignUpload(`stores/${storeId}/products`, b.contentType, b.size);
  }

  @Get('products/:id')
  @PartnerRoles(...VIEW)
  product(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.catalog.product(storeId, id);
  }

  @Patch('products/:id')
  @PartnerRoles(...EDIT)
  update(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(productUpdateSchema)) b: z.infer<typeof productUpdateSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.catalog.update(storeId, id, b, actorOf(u, r));
  }

  @Delete('products/:id')
  @HttpCode(204)
  @PartnerRoles(...EDIT)
  async remove(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    await this.catalog.remove(storeId, id, actorOf(u, r));
  }

  @Put('products/:id/availability')
  @PartnerRoles(...TOGGLE)
  availability(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(availabilitySchema)) b: z.infer<typeof availabilitySchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.catalog.setAvailability(storeId, id, b.isAvailable, actorOf(u, r));
  }

  @Put('products/:id/pause')
  @PartnerRoles(...TOGGLE)
  pause(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(pauseSchema)) b: z.infer<typeof pauseSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.catalog.pause(storeId, id, b.minutes, actorOf(u, r));
  }

  // Inventory ----------------------------------------------------------

  @Get('inventory')
  @PartnerRoles(...STOCK)
  inventoryList(@Param('storeId', ParseUUIDPipe) storeId: string, @Query(new ZodValidationPipe(z.object({ filter: z.enum(['ALL', 'LOW', 'OUT', 'EXPIRING']).default('ALL') }))) q: { filter: 'ALL' | 'LOW' | 'OUT' | 'EXPIRING' }) {
    return this.inventory.list(storeId, q.filter);
  }

  @Post('products/:id/stock')
  @HttpCode(200)
  @PartnerRoles(...STOCK)
  stock(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(stockChangeSchema)) b: z.infer<typeof stockChangeSchema>, @CurrentUser() u: AuthUser, @Req() r: ApiRequest) {
    return this.inventory.change(storeId, id, b, actorOf(u, r));
  }

  @Get('products/:id/stock/movements')
  @PartnerRoles(...STOCK)
  movements(@Param('storeId', ParseUUIDPipe) storeId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.inventory.movements(storeId, id);
  }
}
