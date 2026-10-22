import { z } from 'zod';

const paise = z.number().int().min(0).max(10_000_000);
const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const categorySchema = z.object({ name: z.string().trim().min(1).max(60), isActive: z.boolean().optional() });
export const categoryUpdateSchema = categorySchema.partial().extend({ sortOrder: z.number().int().min(0).max(10_000).optional() });
export const reorderSchema = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) });

export const variantSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(40),
  priceDiff: z.number().int().min(-10_000_000).max(10_000_000),
  isDefault: z.boolean().default(false),
});

export const addonGroupSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    minSelect: z.number().int().min(0).max(20),
    maxSelect: z.number().int().min(1).max(20),
    addons: z.array(z.object({ name: z.string().trim().min(1).max(60), price: paise, isVeg: z.boolean().nullable().optional() })).min(1).max(30),
  })
  .refine((g) => g.maxSelect >= g.minSelect, { message: 'Max choices must be at least the minimum', path: ['maxSelect'] })
  .refine((g) => g.minSelect <= g.addons.length, { message: 'Minimum choices is more than the options available', path: ['minSelect'] });

export const stockSettingsSchema = z.object({
  trackStock: z.boolean(),
  stockQty: z.number().int().min(0).max(1_000_000).optional(),
  lowStockThreshold: z.number().int().min(0).max(100_000).optional(),
  batchNo: text(40),
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});

const productBase = {
  name: z.string().trim().min(2).max(120),
  description: text(500),
  categoryId: z.string().uuid().nullable().optional(),
  images: z.array(z.string().max(300)).max(6).optional(),
  sku: text(60),
  barcode: text(60),
  unit: z.enum(['piece', 'plate', 'kg', 'g', 'litre', 'ml', 'pack', 'dozen', 'strip', 'bottle', 'box']).optional(),
  unitSize: z.number().positive().max(100_000).nullable().optional(),
  price: paise.refine((p) => p > 0, 'Price must be more than ₹0'),
  mrp: paise.nullable().optional(),
  taxRatePct: z.number().min(0).max(28).optional(),
  hsnCode: text(12),
  isAvailable: z.boolean().optional(),
  isComplex: z.boolean().optional(),
  prepMinutes: z.number().int().min(1).max(120).nullable().optional(),
  maxQtyPerOrder: z.number().int().min(1).max(999).nullable().optional(),
  isVeg: z.boolean().nullable().optional(),
  spiceLevel: z.number().int().min(0).max(3).nullable().optional(),
  prescriptionRequired: z.boolean().optional(),
  drugSchedule: z.enum(['NONE', 'OTC', 'H', 'H1', 'X']).optional(),
  saltComposition: text(200),
  manufacturer: text(120),
  substitutionAllowed: z.boolean().optional(),
  // Lab tests (DIAGNOSTICS stores)
  labSampleType: z.enum(['BLOOD', 'URINE', 'STOOL', 'SWAB', 'SALIVA', 'OTHER']).nullable().optional(),
  labFastingHours: z.number().int().min(0).max(24).nullable().optional(),
  labReportHours: z.number().int().min(1).max(720).nullable().optional(),
  labHomeCollection: z.boolean().nullable().optional(),
  labWalkIn: z.boolean().nullable().optional(),
  labParameters: z.number().int().min(1).max(500).nullable().optional(),
  labPreparation: z.string().trim().max(300).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).optional(),
  variants: z.array(variantSchema).max(12).optional(),
  addonGroups: z.array(addonGroupSchema).max(8).optional(),
  stock: stockSettingsSchema.optional(),
};

export const productCreateSchema = z.object(productBase).refine((p) => p.mrp == null || p.mrp >= p.price, { message: 'MRP cannot be lower than the selling price', path: ['mrp'] });
export const productUpdateSchema = z.object(productBase).partial();

export const productQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  q: z.string().trim().max(80).optional(),
  status: z.enum(['AVAILABLE', 'HIDDEN', 'PAUSED', 'OUT_OF_STOCK', 'LOW_STOCK']).optional(),
});

export const availabilitySchema = z.object({ isAvailable: z.boolean() });
export const pauseSchema = z.object({ minutes: z.number().int().min(5).max(24 * 60).nullable() });

export const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(500),
  action: z.enum(['MAKE_AVAILABLE', 'MAKE_UNAVAILABLE', 'DELETE', 'MOVE', 'PRICE_PERCENT']),
  categoryId: z.string().uuid().nullable().optional(),
  percent: z.number().min(-50).max(100).optional(),
});

export const stockChangeSchema = z
  .object({
    mode: z.enum(['SET', 'ADJUST']),
    qty: z.number().int().min(-1_000_000).max(1_000_000),
    type: z.enum(['PURCHASE', 'ADJUSTMENT', 'EXPIRY_WRITEOFF', 'RETURN']).default('ADJUSTMENT'),
    note: z.string().trim().max(200).optional(),
  })
  .refine((s) => s.mode === 'ADJUST' || s.qty >= 0, { message: 'Stock cannot be negative', path: ['qty'] });

export const importSchema = z.object({
  csv: z.string().min(1).max(1_000_000),
  /** Update existing items with the same SKU (or name when there is no SKU) instead of creating duplicates. */
  updateExisting: z.boolean().default(true),
});

export type ProductCreate = z.infer<typeof productCreateSchema>;
export type ProductUpdate = z.infer<typeof productUpdateSchema>;
