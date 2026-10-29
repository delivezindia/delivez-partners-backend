import { z } from 'zod';
import { timingSchema } from '../onboarding/flows';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === undefined ? undefined : v ? v : null));

export const settingsSchema = z
  .object({
    description: optionalText(300),
    cuisines: z.array(z.string().trim().min(2).max(40)).max(10),
    whatsappPhone: optionalText(15),
    email: z.string().trim().email().max(120).nullable().or(z.literal('').transform(() => null)),
    logoUrl: optionalText(500),
    coverUrl: optionalText(500),
    supportsDelivery: z.boolean(),
    supportsPickup: z.boolean(),
    deliveryRadiusKm: z.number().min(1).max(15),
    expressEnabled: z.boolean(),
    defaultPrepMinutes: z.number().int().min(5).max(90),
    peakPrepMinutes: z.number().int().min(5).max(120),
    acceptMultipleOrders: z.boolean(),
    allowSubstitutions: z.boolean(),
    maxOrdersPerHour: z.number().int().min(1).max(500).nullable(),
    autoPauseOverloaded: z.boolean(),
    autoAcceptOrders: z.boolean(),
    minOrderAmount: z.number().int().min(0).max(1_000_000), // paise
    packagingFee: z.number().int().min(0).max(10_000), // paise
    collectionFee: z.number().int().min(0).max(100_000), // paise — labs only
    aiPrepEnabled: z.boolean(),
    aiAlertsEnabled: z.boolean(),
    aiAutoExtendEta: z.boolean(),
    aiMenuAutoPause: z.boolean(),
    aiAggressiveness: z.number().int().min(0).max(100),
    allowGenericSubstitution: z.boolean(),
    contactIfRxUnclear: z.boolean(),
  })
  .partial();

export type SettingsInput = z.infer<typeof settingsSchema>;

export const timingsSchema = z.object({ timings: z.array(timingSchema).max(28) });
export type TimingInput = z.infer<typeof timingSchema>;

export const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
  reason: z.string().trim().max(120).optional(),
});

export const legalAcceptSchema = z.object({ acceptedDocIds: z.array(z.string().uuid()).min(1) });

const ROLES_INVITABLE = ['MANAGER', 'KITCHEN_LEAD', 'COUNTER_STAFF', 'PHARMACIST', 'ACCOUNTANT'] as const;

export const inviteSchema = z.object({
  phone: z.string(),
  name: z.string().trim().min(2).max(80).optional(),
  role: z.enum(ROLES_INVITABLE),
  /** Empty = every outlet of the account (owners only). Defaults to the current outlet. */
  storeIds: z.array(z.string().uuid()).max(50).optional(),
});

export const memberUpdateSchema = z
  .object({
    role: z.enum(ROLES_INVITABLE),
    storeIds: z.array(z.string().uuid()).max(50),
    isActive: z.boolean(),
  })
  .partial();

export const pinSchema = z.object({ pin: z.string().regex(/^\d{4}$/, 'PIN must be 4 digits') });
export const pinSwitchSchema = z.object({ memberId: z.string().uuid(), pin: z.string().regex(/^\d{4}$/) });

export const reviewsQuery = z.object({
  filter: z.enum(['ALL', 'UNREPLIED', 'LOW']).default('ALL'),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const reviewReplySchema = z.object({ reply: z.string().trim().min(2).max(500) });
