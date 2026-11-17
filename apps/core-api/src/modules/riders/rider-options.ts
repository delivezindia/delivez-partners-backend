import { z } from 'zod';
import type { RiderDocumentType } from '@delivez/db';

// Choices and checks for the rider app's sign-up screens (Delivez Agent app: onboarding/personal-info …
// onboarding/safety-compliance). The app builds its dropdowns from GET /v1/rider/registration/options, so both
// sides use the same keys.

const opt = <V extends string>(value: V, label: string) => ({ value, label });

export const RIDER_OPTIONS = {
  idTypes: [opt('AADHAAR', 'Aadhaar Card (UIDAI)'), opt('PAN', 'PAN Card'), opt('VOTER_ID', 'Voter ID'), opt('PASSPORT', 'Passport')],
  vehicleTypes: [
    opt('BIKE', 'Motorcycle'),
    opt('SCOOTER', 'Scooter'),
    opt('EV', 'Electric Scooter (EV)'),
    opt('BICYCLE', 'Bicycle / E-bike'),
    opt('CAR', 'Car'),
    opt('VAN', 'Van'),
    opt('MINI_TRUCK', 'Mini truck'),
  ],
  licenceTypes: [
    opt('MCWG', 'Two-wheeler licence (MCWG)'),
    opt('LMV', 'LMV licence'),
    opt('LMV_TRANSPORT', 'Three-wheeler / LMV commercial licence'),
    opt('HMV', 'HMV licence'),
  ],
  vehicleOwnership: [opt('OWNED', 'Owned / Self'), opt('LEASED', 'Leased / Financed'), opt('RENTED', 'Rented'), opt('COMPANY', 'Company provided')],
  vehicleCondition: [opt('GOOD', 'Good condition'), opt('FAIR', 'Fair condition'), opt('NEEDS_REPAIR', 'Needs repair')],
  workTypes: [opt('FULL_TIME', 'Full-time partner'), opt('PART_TIME', 'Part-time partner'), opt('WEEKEND', 'Weekend flex')],
  smartphones: [opt('ANDROID_11_PLUS', 'Android smartphone (v11 or above)'), opt('ANDROID_OLDER', 'Android below v11'), opt('IPHONE', 'iPhone')],
  dataPlans: [opt('UNLIMITED', 'Unlimited / daily data pack'), opt('MONTHLY', 'Monthly pack'), opt('LIMITED', 'Limited data'), opt('NONE', 'No data plan')],
  jobTypes: [opt('FOOD', 'Food delivery'), opt('GROCERY', 'Grocery'), opt('PHARMACY', 'Pharmacy'), opt('PARCEL', 'Parcels / courier'), opt('STREET', 'Street Cart / local bazaar')],
  trainingModules: [
    opt('DELIVERY_SOP', 'Delivery SOP: arrival, verification, OTP, COD note counting, POD'),
    opt('PICKUP_SOP', 'Pickup & reverse-pickup SOP'),
    opt('NAVIGATION_APP', 'Navigation & app training'),
    opt('CUSTOMER_CONDUCT', 'Customer conduct'),
    opt('ROAD_SAFETY', 'Road safety basics'),
  ],
  trainingNeeds: [opt('NONE', 'None / Experienced'), opt('APP', 'App and navigation'), opt('CUSTOMER', 'Customer handling'), opt('CASH', 'Cash handling')],
  safetyDeclarations: [
    opt('HELMET_SPEED', 'I follow helmet and speed safety rules'),
    opt('PHONE_MOUNTED', 'My phone is mounted before I ride'),
    opt('CONDUCT', 'Professional with customers; zero tolerance for harassment'),
    opt('REPORT_INCIDENTS', 'I report accidents and incidents immediately'),
    opt('NO_INTOXICATION', 'I never ride under the influence of alcohol or drugs'),
  ],
  statutoryDeclarations: [
    opt('VALID_LICENCE', 'I hold a valid Indian Driving Licence for the vehicle category I selected'),
    opt('VEHICLE_PAPERS', 'My vehicle has valid registration, third-party insurance and fitness certificate'),
    opt('POLICE_VERIFICATION', 'I consent to police verification'),
    opt('ACCURATE_INFO', 'The information I give is accurate and may be reviewed by Delivez'),
  ],
  documentTypes: [
    opt('PHOTO', 'Passport photo'),
    opt('DRIVING_LICENCE', 'Driving licence'),
    opt('VEHICLE_RC', 'Vehicle registration certificate (RC)'),
    opt('VEHICLE_INSURANCE', 'Vehicle insurance'),
    opt('BANK_PROOF', 'Cancelled cheque or passbook'),
  ],
} as const;

type Values<K extends keyof typeof RIDER_OPTIONS> = (typeof RIDER_OPTIONS)[K][number]['value'];
const oneOf = <K extends keyof typeof RIDER_OPTIONS>(k: K, message: string) =>
  z.enum(RIDER_OPTIONS[k].map((o) => o.value) as [Values<K>, ...Values<K>[]], { errorMap: () => ({ message }) });

export type VehicleType = Values<'vehicleTypes'>;
export type LicenceType = Values<'licenceTypes'>;

/** Licence categories that cover each vehicle. A bicycle / e-bike needs none (and no RC or insurance). */
export const LICENCE_FOR: Record<VehicleType, LicenceType[]> = {
  BIKE: ['MCWG'],
  SCOOTER: ['MCWG'],
  EV: ['MCWG'],
  BICYCLE: [],
  CAR: ['LMV', 'LMV_TRANSPORT', 'HMV'],
  VAN: ['LMV', 'LMV_TRANSPORT', 'HMV'],
  MINI_TRUCK: ['LMV_TRANSPORT', 'HMV'],
};
export const needsLicence = (v: VehicleType | undefined | null) => !!v && LICENCE_FOR[v].length > 0;

/** Files ops need before an application can be sent. */
export const requiredDocuments = (vehicle: VehicleType | undefined | null): RiderDocumentType[] =>
  needsLicence(vehicle) ? ['PHOTO', 'DRIVING_LICENCE', 'VEHICLE_RC', 'VEHICLE_INSURANCE', 'BANK_PROOF'] : ['PHOTO', 'BANK_PROOF'];

const isoDate = (message: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, message).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), message);
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
export function ageOn(dob: string, today = todayIst()) {
  const [y, m, d] = dob.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

/** "ka 51 ab 1234" → "KA51AB1234"; Bharat series "22 BH 1234 AA" → "22BH1234AA". */
export const normalizePlate = (s: string) => s.toUpperCase().replace(/[\s.-]/g, '');
export const isPlate = (s: string) => /^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{4}$/.test(s) || /^\d{2}BH\d{4}[A-Z]{1,2}$/.test(s);
export const normalizeLicence = (s: string) => s.toUpperCase().replace(/[\s/-]/g, '');
export const isLicenceNo = (s: string) => /^[A-Z]{2}\d{2}[0-9A-Z]{9,13}$/.test(s);

const personalInfo = z.object({
  fullName: z
    .string()
    .trim()
    .transform((s) => s.replace(/\s+/g, ' '))
    .pipe(z.string().regex(/^[A-Za-z][A-Za-z .']{1,79}$/, 'Enter your full name as per Aadhaar / PAN card.')),
  dob: isoDate('Select your date of birth.')
    .refine((d) => ageOn(d) >= 18, 'You must be at least 18 years old.')
    .refine((d) => ageOn(d) <= 70, 'Check your date of birth.'),
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(120).optional().nullable(),
  pincode: z.string().trim().regex(/^[1-9]\d{5}$/, 'Enter a valid 6-digit pincode.'),
});

const legalVehicle = z
  .object({
    idType: oneOf('idTypes', 'Choose the ID type.'),
    idLast4: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}$/, 'Enter the last 4 characters of the ID number.'),
    vehicleType: oneOf('vehicleTypes', 'Select your vehicle type.'),
    vehicleOwnership: oneOf('vehicleOwnership', 'Select the vehicle ownership.'),
    vehicleCondition: oneOf('vehicleCondition', 'Select the vehicle condition.'),
    vehicleRegistration: z.string().transform(normalizePlate).optional().nullable(),
    licenceType: oneOf('licenceTypes', 'Select your licence category.').optional().nullable(),
    licenceNumber: z.string().transform(normalizeLicence).optional().nullable(),
    licenceExpiry: isoDate('Select the licence validity date.').optional().nullable(),
    licenceDeclaration: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (!needsLicence(v.vehicleType)) return;
    const bad = (path: string, message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });
    if (!v.vehicleRegistration || !isPlate(v.vehicleRegistration)) bad('vehicleRegistration', 'Enter the registration number as on the RC, e.g. KA 51 AB 1234.');
    if (!v.licenceType) bad('licenceType', 'Select your licence category.');
    else if (!LICENCE_FOR[v.vehicleType].includes(v.licenceType)) bad('licenceType', 'This licence category does not cover the selected vehicle.');
    if (!v.licenceNumber || !isLicenceNo(v.licenceNumber)) bad('licenceNumber', 'Enter the number as on your licence.');
    if (!v.licenceExpiry) bad('licenceExpiry', 'Select the licence validity date.');
    else if (v.licenceExpiry <= todayIst()) bad('licenceExpiry', 'This licence has expired.');
    if (v.licenceDeclaration !== true) bad('licenceDeclaration', 'Confirm you hold a valid Indian Driving Licence for this vehicle.');
  })
  // Licence fields mean nothing for a bicycle: drop them so stale values are never shown to ops.
  .transform((v) =>
    needsLicence(v.vehicleType)
      ? v
      : { ...v, vehicleRegistration: v.vehicleRegistration || null, licenceType: null, licenceNumber: null, licenceExpiry: null, licenceDeclaration: undefined },
  );

const workTech = z.object({
  workType: oneOf('workTypes', 'Select how you want to work.'),
  smartphone: oneOf('smartphones', 'Select your smartphone.'),
  dataPlan: oneOf('dataPlans', 'Select your mobile data plan.'),
});

const hyperlocal = z.object({
  jobTypes: z
    .array(oneOf('jobTypes', 'Unknown job type.'))
    .min(1, 'Select at least one Hyperlocal job type.')
    .transform((a) => [...new Set(a)]),
});

const MODULES = RIDER_OPTIONS.trainingModules.map((m) => m.value);
const trainingRole = z.object({
  completedModules: z
    .array(oneOf('trainingModules', 'Unknown training module.'))
    .transform((a) => [...new Set(a)])
    .refine((a) => MODULES.every((m) => a.includes(m)), `Please complete all ${MODULES.length} training modules to proceed.`),
  trainingNeeds: z
    .array(oneOf('trainingNeeds', 'Unknown training need.'))
    .min(1, 'Select your training needs.')
    .transform((a) => [...new Set(a)])
    .refine((a) => !(a.includes('NONE') && a.length > 1), '"None / Experienced" cannot be combined with other needs.'),
});

const allTrue = <K extends 'safetyDeclarations' | 'statutoryDeclarations'>(k: K, message: string) => {
  const keys = RIDER_OPTIONS[k].map((o) => o.value);
  return z
    .record(z.boolean())
    .refine((r) => keys.every((key) => r[key] === true), message)
    .transform(() => Object.fromEntries(keys.map((key) => [key, true])));
};
const safetyCompliance = z.object({
  safetyDeclarations: allTrue('safetyDeclarations', `Please accept all ${RIDER_OPTIONS.safetyDeclarations.length} safety declarations to complete this step.`),
  statutoryDeclarations: allTrue('statutoryDeclarations', `Please accept all ${RIDER_OPTIONS.statutoryDeclarations.length} statutory declarations to proceed.`),
});

/** URL step name → body schema and the application column it is saved in. */
export const STEPS = {
  'personal-info': { schema: personalInfo, field: 'personalInfo' },
  'legal-vehicle': { schema: legalVehicle, field: 'legalVehicle' },
  'work-tech': { schema: workTech, field: 'workTech' },
  hyperlocal: { schema: hyperlocal, field: 'hyperlocal' },
  'training-role': { schema: trainingRole, field: 'trainingRole' },
  'safety-compliance': { schema: safetyCompliance, field: 'safetyCompliance' },
} as const;
export type StepName = keyof typeof STEPS;
export const STEP_NAMES = Object.keys(STEPS) as StepName[];
export type StepField = (typeof STEPS)[StepName]['field'];
