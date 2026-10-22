import { z } from 'zod';
import type { DocumentType, PartnerType, StoreType, Vertical } from '@delivez/db';

// Onboarding flow definitions (plan §5.1.1). One engine serves web, mobile and (later) WhatsApp.

export type FlowVersion = 'RESTAURANT_V1' | 'STORE_V1' | 'PHARMACY_V1' | 'LAB_V1' | 'VENDOR_V1';
export type StepKey =
  | 'ELIGIBILITY'
  | 'BASIC_DETAILS'
  | 'OUTLET'
  | 'DOCUMENTS'
  | 'PHARMACIST'
  | 'PATHOLOGIST'
  | 'CATALOG'
  | 'OPERATIONS'
  | 'BANK'
  | 'COMMERCIALS'
  | 'LEGAL'
  | 'TRAINING'
  | 'REVIEW';

export interface StepDef {
  key: StepKey;
  title: string;
  /** Optional steps can be skipped; readiness still reflects them. */
  optional?: boolean;
}

const S = (key: StepKey, title: string, optional = false): StepDef => ({ key, title, optional });

export const FLOWS: Record<FlowVersion, StepDef[]> = {
  RESTAURANT_V1: [
    S('BASIC_DETAILS', 'Restaurant details'),
    S('OUTLET', 'Location & hours'),
    S('DOCUMENTS', 'Documents', true),
    S('CATALOG', 'Menu', true),
    S('OPERATIONS', 'Prep time & operations'),
    S('BANK', 'Bank account', true),
    S('COMMERCIALS', 'Commercials'),
    S('LEGAL', 'Agreements'),
    S('REVIEW', 'Review & submit'),
  ],
  STORE_V1: [
    S('ELIGIBILITY', 'Eligibility'),
    S('BASIC_DETAILS', 'Store details'),
    S('OUTLET', 'Location & hours'),
    S('DOCUMENTS', 'Documents', true),
    S('CATALOG', 'Products', true),
    S('OPERATIONS', 'Operations'),
    S('BANK', 'Bank & payouts', true),
    S('COMMERCIALS', 'Commercials'),
    S('LEGAL', 'Agreements'),
    S('TRAINING', 'Quick training', true),
    S('REVIEW', 'Review & submit'),
  ],
  PHARMACY_V1: [
    S('ELIGIBILITY', 'Requirements'),
    S('BASIC_DETAILS', 'Pharmacy details'),
    S('OUTLET', 'Location & hours'),
    S('DOCUMENTS', 'Licences & documents'),
    S('PHARMACIST', 'Registered pharmacist'),
    S('CATALOG', 'Medicines', true),
    S('OPERATIONS', 'Prescription rules'),
    S('BANK', 'Bank & settlement', true),
    S('COMMERCIALS', 'Commercials'),
    S('LEGAL', 'Agreements'),
    S('TRAINING', 'Training & quiz'),
    S('REVIEW', 'Go-live checklist'),
  ],
  // Certified pathology labs: tests & packages with home collection and/or walk-in.
  LAB_V1: [
    S('ELIGIBILITY', 'Requirements'),
    S('BASIC_DETAILS', 'Lab details'),
    S('OUTLET', 'Location & hours'),
    S('DOCUMENTS', 'Licences & accreditation'),
    S('PATHOLOGIST', 'Pathologist'),
    S('CATALOG', 'Tests & packages', true),
    S('OPERATIONS', 'Sample collection'),
    S('BANK', 'Bank & settlement', true),
    S('COMMERCIALS', 'Commercials'),
    S('LEGAL', 'Agreements'),
    S('REVIEW', 'Go-live checklist'),
  ],
  VENDOR_V1: [
    S('BASIC_DETAILS', 'Your details'),
    S('OUTLET', 'Location & hours'),
    S('CATALOG', 'What you sell', true),
    S('BANK', 'UPI for payouts', true),
    S('LEGAL', 'Agreement'),
    S('REVIEW', 'Submit'),
  ],
};

const VERTICAL_BY_TYPE: Record<StoreType, Vertical> = {
  RESTAURANT: 'EAT',
  CLOUD_KITCHEN: 'EAT',
  GROCERY: 'GROCERY',
  KIRANA: 'GROCERY',
  SUPERMARKET: 'GROCERY',
  PHARMACY_RETAIL: 'PHARMACY',
  PHARMACY_CHAIN: 'PHARMACY',
  PHARMACY_HOSPITAL: 'PHARMACY',
  DIAGNOSTIC_LAB: 'DIAGNOSTICS',
  DIAGNOSTIC_CHAIN: 'DIAGNOSTICS',
  HOSPITAL_LAB: 'DIAGNOSTICS',
  BAKERY: 'LOCAL_STORES',
  MEAT_FISH: 'LOCAL_STORES',
  FLOWER: 'LOCAL_STORES',
  ELECTRONICS: 'LOCAL_STORES',
  CLOTHING: 'LOCAL_STORES',
  BEAUTY_WELLNESS: 'LOCAL_STORES',
  HOUSEHOLD_LIFESTYLE: 'LOCAL_STORES',
  BABY_CARE: 'LOCAL_STORES',
  PET_CARE: 'LOCAL_STORES',
  PRINTING: 'LOCAL_STORES',
  STREET_VENDOR: 'LOCAL_STORES',
  SOCIETY_VENDOR: 'LOCAL_STORES',
  OTHER: 'LOCAL_STORES',
};

export function flowFor(storeType: StoreType): { flowVersion: FlowVersion; vertical: Vertical; partnerType: PartnerType } {
  const vertical = VERTICAL_BY_TYPE[storeType];
  if (storeType === 'STREET_VENDOR' || storeType === 'SOCIETY_VENDOR') {
    return { flowVersion: 'VENDOR_V1', vertical, partnerType: 'INDIVIDUAL' };
  }
  if (vertical === 'EAT') return { flowVersion: 'RESTAURANT_V1', vertical, partnerType: 'PROPRIETORSHIP' };
  if (vertical === 'PHARMACY') return { flowVersion: 'PHARMACY_V1', vertical, partnerType: 'PROPRIETORSHIP' };
  if (vertical === 'DIAGNOSTICS') return { flowVersion: 'LAB_V1', vertical, partnerType: 'PROPRIETORSHIP' };
  return { flowVersion: 'STORE_V1', vertical, partnerType: 'PROPRIETORSHIP' };
}

const FOOD_LOCAL_TYPES: StoreType[] = ['BAKERY', 'MEAT_FISH'];

/** Documents that must be uploaded before submission (pharmacy: verified before LIVE). */
export function requiredDocuments(storeType: StoreType): DocumentType[] {
  const vertical = VERTICAL_BY_TYPE[storeType];
  if (vertical === 'PHARMACY') return ['DRUG_LICENSE_DL20', 'DRUG_LICENSE_DL21', 'PHARMACIST_REGISTRATION', 'ADDRESS_PROOF'];
  if (vertical === 'DIAGNOSTICS') return ['NABL_CERTIFICATE', 'CLINICAL_ESTABLISHMENT_REG', 'PATHOLOGIST_REGISTRATION', 'ADDRESS_PROOF'];
  if (vertical === 'EAT' || vertical === 'GROCERY' || FOOD_LOCAL_TYPES.includes(storeType)) return ['FSSAI'];
  return [];
}

export function optionalDocuments(storeType: StoreType): DocumentType[] {
  if (storeType === 'STREET_VENDOR' || storeType === 'SOCIETY_VENDOR') return ['FSSAI', 'TRADE_LICENSE', 'LANDMARK_PHOTO'];
  const base: DocumentType[] = ['GSTIN', 'PAN', 'BANK_PROOF', 'SHOP_ESTABLISHMENT', 'LANDMARK_PHOTO'];
  const required = requiredDocuments(storeType);
  const extra: DocumentType[] = VERTICAL_BY_TYPE[storeType] === 'LOCAL_STORES' && !required.includes('FSSAI') ? ['TRADE_LICENSE'] : [];
  return [...base, ...extra].filter((d) => !required.includes(d));
}

export const PARTNER_LEGAL_TYPES = ['PARTNER_TNC', 'SLA_TERMS', 'PENALTY_FRAMEWORK'] as const;

export const PHARMACY_QUIZ = [
  {
    question: 'A customer orders a Schedule H medicine without a prescription. What do you do?',
    options: ['Dispatch it — the customer asked for it', 'Ask for a valid prescription before dispatch', 'Send a different brand instead'],
    answer: 1,
  },
  {
    question: 'Can Schedule X medicines be sold through Delivez?',
    options: ['Yes, with a prescription', 'No, never', 'Only for cash on delivery'],
    answer: 1,
  },
  {
    question: "The date on a prescription isn't readable. You should…",
    options: ['Approve it anyway', 'Mark "Clarification needed" and message the customer', 'Reject it without a reason'],
    answer: 1,
  },
] as const;
export const PHARMACY_QUIZ_PASS = 2;

// ---------------------------------------------------------------------
// Step payload schemas
// ---------------------------------------------------------------------

export const LAB_SAMPLE_TYPES = ['BLOOD', 'URINE', 'STOOL', 'SWAB', 'SALIVA', 'OTHER'] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const timingSchema = z
  .object({ dayOfWeek: z.number().int().min(0).max(6), opensAt: hhmm, closesAt: hhmm })
  .refine((t) => t.closesAt > t.opensAt, { message: 'Closing time must be after opening time' });

export const STEP_SCHEMAS = {
  ELIGIBILITY: z.object({
    pincode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit PIN code'),
    hoursPerDay: z.number().min(0).max(24),
    homeDelivery: z.boolean(),
    hasDrugLicense: z.boolean().optional(),
    hasPharmacist: z.boolean().optional(),
    hasNablAccreditation: z.boolean().optional(),
    hasPathologist: z.boolean().optional(),
  }),
  BASIC_DETAILS: z.object({
    storeName: z.string().trim().min(2).max(80),
    ownerName: z.string().trim().min(2).max(80),
    legalName: optionalText(120),
    partnerType: z.enum(['INDIVIDUAL', 'PROPRIETORSHIP', 'PARTNERSHIP', 'PVT_LTD', 'LLP', 'OTHER']).optional(),
    email: z.string().trim().email().max(120).optional().or(z.literal('').transform(() => undefined)),
    whatsappPhone: optionalText(15),
    gstin: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'GSTIN format looks wrong')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    cuisines: z.array(z.string().trim().min(2).max(40)).max(10).optional(),
    description: optionalText(300),
  }),
  OUTLET: z.object({
    addressLine1: z.string().trim().min(5).max(160),
    addressLine2: optionalText(160),
    landmark: optionalText(120),
    pincode: z.string().regex(/^\d{6}$/, 'Enter a 6-digit PIN code'),
    lat: z.number().min(6).max(38),
    lng: z.number().min(68).max(98),
    placeId: optionalText(200),
    timings: z.array(timingSchema).min(1, 'Add your opening hours').max(21),
    seatingType: z.enum(['DINE_IN', 'TAKEAWAY', 'CLOUD']).optional(),
  }),
  DOCUMENTS: z.object({}).passthrough(),
  PHARMACIST: z.object({
    name: z.string().trim().min(2).max(80),
    registrationNo: z.string().trim().min(3).max(40),
    stateCouncil: z.string().trim().min(2).max(80),
    shifts: z.array(z.object({ dayOfWeek: z.number().int().min(0).max(6), startsAt: hhmm, endsAt: hhmm })).min(1, 'Add on-duty hours').max(21),
    consent: z.literal(true, { errorMap: () => ({ message: 'The pharmacist must confirm prescription verification' }) }),
  }),
  PATHOLOGIST: z.object({
    name: z.string().trim().min(2).max(80),
    qualification: z.string().trim().min(2).max(80),
    registrationNo: z.string().trim().min(3).max(40),
    stateCouncil: z.string().trim().min(2).max(80),
    consent: z.literal(true, { errorMap: () => ({ message: 'The pathologist must confirm they will review and sign every report' }) }),
  }),
  CATALOG: z.object({
    items: z
      .array(
        z.object({
          name: z.string().trim().min(2).max(120),
          price: z.number().int().positive().max(10_000_000), // paise
          mrp: z.number().int().positive().max(10_000_000).optional(),
          category: optionalText(60),
          isVeg: z.boolean().optional(),
          unit: optionalText(20),
          stock: z.number().int().min(0).max(1_000_000).optional(),
          prescriptionRequired: z.boolean().optional(),
          drugSchedule: z.enum(['NONE', 'OTC', 'H', 'H1', 'X']).optional(),
          // Lab tests
          sampleType: z.enum(LAB_SAMPLE_TYPES).optional(),
          fastingHours: z.number().int().min(0).max(24).optional(),
          reportHours: z.number().int().min(1).max(720).optional(),
          homeCollection: z.boolean().optional(),
          walkIn: z.boolean().optional(),
          parameters: z.number().int().min(1).max(500).optional(),
        }),
      )
      .max(200)
      .default([]),
  }),
  OPERATIONS: z
    .object({
      defaultPrepMinutes: z.number().int().min(5).max(90),
      peakPrepMinutes: z.number().int().min(5).max(120),
      aiPrepEnabled: z.boolean().default(true),
      supportsDelivery: z.boolean(),
      supportsPickup: z.boolean(),
      deliveryRadiusKm: z.number().min(1).max(15),
      acceptMultipleOrders: z.boolean().optional(),
      allowSubstitutions: z.boolean().optional(),
      maxOrdersPerHour: z.number().int().min(1).max(500).nullable().optional(),
      autoPauseOverloaded: z.boolean().optional(),
      packagingFee: z.number().int().min(0).max(10_000).optional(), // paise
      collectionFee: z.number().int().min(0).max(100_000).optional(), // paise — labs: home collection fee
      allowGenericSubstitution: z.boolean().optional(),
      contactIfRxUnclear: z.boolean().optional(),
      selfPackagingConfirmed: z.boolean().optional(),
    })
    .refine((o) => o.peakPrepMinutes >= o.defaultPrepMinutes, { message: 'Peak prep time should be at least the normal prep time', path: ['peakPrepMinutes'] })
    .refine((o) => o.supportsDelivery || o.supportsPickup, { message: 'Choose delivery, pickup or both', path: ['supportsDelivery'] }),
  BANK: z.object({}).passthrough(),
  COMMERCIALS: z.object({ acknowledged: z.literal(true, { errorMap: () => ({ message: 'Please confirm the commercials' }) }) }),
  LEGAL: z.object({ acceptedDocIds: z.array(z.string().uuid()).min(1) }),
  TRAINING: z.object({
    videoWatched: z.boolean(),
    practiceOrderDone: z.boolean(),
    quizAnswers: z.array(z.number().int().min(0).max(5)).optional(),
  }),
  REVIEW: z.object({}).passthrough(),
} satisfies Record<StepKey, z.ZodTypeAny>;

export type StepPayload<K extends StepKey> = z.infer<(typeof STEP_SCHEMAS)[K]>;
