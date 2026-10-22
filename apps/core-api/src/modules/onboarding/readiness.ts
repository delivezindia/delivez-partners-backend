import type { BankVerificationStatus, DocumentStatus, DocumentType, Vertical } from '@delivez/db';
import type { FlowVersion, StepKey } from './flows';

// Readiness score (plan §5.1.3): Σ weight × completion, completion ∈ {0, 0.5, 1}.
// ≥ 80 → eligible for LIVE · 60–79 → LIMITED (soft launch) · < 60 → blocked with a fix-list.

export interface ReadinessInput {
  flowVersion: FlowVersion;
  vertical: Vertical;
  completedSteps: string[];
  addressConfidence: string | null;
  maxDailyHours: number;
  defaultPrepMinutes: number;
  peakPrepMinutes: number;
  requiredDocTypes: DocumentType[];
  docs: { type: DocumentType; status: DocumentStatus }[];
  productsAvailable: number;
  productsWithStock: number;
  bankStatus: BankVerificationStatus | null;
  legalComplete: boolean;
  pharmacistActive: boolean;
  pathologistActive: boolean;
  trainingDone: boolean;
}

export interface ReadinessFactor {
  factor: string;
  label: string;
  weight: number;
  completion: 0 | 0.5 | 1;
  points: number;
  hint: string | null;
  step: StepKey;
}

export type ReadinessGate = 'LIVE' | 'LIMITED' | 'BLOCKED';

export interface Readiness {
  score: number;
  gate: ReadinessGate;
  factors: ReadinessFactor[];
}

type Completion = 0 | 0.5 | 1;
type FactorCalc = { completion: Completion; hint: string | null };

function documents(i: ReadinessInput): FactorCalc {
  if (!i.requiredDocTypes.length) return { completion: 1, hint: null };
  const usable = new Set(i.docs.filter((d) => d.status !== 'REJECTED' && d.status !== 'EXPIRED').map((d) => d.type));
  const missing = i.requiredDocTypes.filter((t) => !usable.has(t));
  return {
    completion: missing.length === 0 ? 1 : missing.length < i.requiredDocTypes.length ? 0.5 : 0,
    hint: missing.length ? `Upload ${missing.map(docLabel).join(', ')}` : null,
  };
}

function catalog(i: ReadinessInput, min: number, needStock: boolean): FactorCalc {
  const count = needStock ? i.productsWithStock : i.productsAvailable;
  const noun = needStock ? 'products with stock' : 'items';
  if (count >= min) return { completion: 1, hint: null };
  return { completion: count > 0 ? 0.5 : 0, hint: `Add at least ${min} ${noun} (${count} so far)` };
}

function prep(i: ReadinessInput): FactorCalc {
  if (!i.completedSteps.includes('OPERATIONS')) return { completion: 0, hint: 'Set your prep time' };
  const realistic = i.defaultPrepMinutes >= 10 && i.defaultPrepMinutes <= 60 && i.peakPrepMinutes >= i.defaultPrepMinutes;
  return realistic ? { completion: 1, hint: null } : { completion: 0.5, hint: 'Prep time should be between 10 and 60 minutes' };
}

function bank(i: ReadinessInput): FactorCalc {
  if (i.bankStatus === 'VERIFIED') return { completion: 1, hint: null };
  if (i.bankStatus) return { completion: 0.5, hint: 'Bank account is waiting for verification' };
  return { completion: 0, hint: 'Add a bank account for payouts' };
}

function legal(i: ReadinessInput): FactorCalc {
  return i.legalComplete ? { completion: 1, hint: null } : { completion: 0, hint: 'Accept the partner agreements' };
}

function location(i: ReadinessInput): FactorCalc {
  if (!i.completedSteps.includes('OUTLET')) return { completion: 0, hint: 'Pin your outlet on the map' };
  return i.addressConfidence === 'HIGH'
    ? { completion: 1, hint: null }
    : { completion: 0.5, hint: 'Check the map pin matches your PIN code' };
}

function hours(i: ReadinessInput): FactorCalc {
  if (i.maxDailyHours >= 6) return { completion: 1, hint: null };
  return { completion: i.maxDailyHours > 0 ? 0.5 : 0, hint: 'Stores should be open at least 6 hours a day' };
}

function avg(...parts: FactorCalc[]): FactorCalc {
  const mean = parts.reduce((s, p) => s + p.completion, 0) / parts.length;
  const completion: Completion = mean === 1 ? 1 : mean > 0 ? 0.5 : 0;
  return { completion, hint: parts.map((p) => p.hint).filter(Boolean).join(' · ') || null };
}

export function computeReadiness(i: ReadinessInput): Readiness {
  const f = (factor: string, label: string, weight: number, step: StepKey, calc: FactorCalc): ReadinessFactor => ({
    factor,
    label,
    weight,
    step,
    completion: calc.completion,
    points: weight * calc.completion,
    hint: calc.hint,
  });

  let factors: ReadinessFactor[];
  switch (i.flowVersion) {
    case 'RESTAURANT_V1':
      factors = [
        f('docs', 'Documents', 25, 'DOCUMENTS', documents(i)),
        f('menu', 'Menu', 25, 'CATALOG', catalog(i, 5, false)),
        f('prep', 'Prep time', 20, 'OPERATIONS', prep(i)),
        f('bank', 'Bank account', 20, 'BANK', bank(i)),
        f('legal', 'Agreements', 10, 'LEGAL', legal(i)),
      ];
      break;
    case 'STORE_V1': {
      const grocery = i.vertical === 'GROCERY';
      factors = [
        f('location', 'Location', 25, 'OUTLET', location(i)),
        f('prep', 'Prep realism', 25, 'OPERATIONS', prep(i)),
        f('inventory', 'Inventory', 20, 'CATALOG', catalog(i, grocery ? 50 : 10, grocery)),
        f('hours', 'Hours', 15, 'OUTLET', hours(i)),
        f('compliance', 'Compliance', 15, 'DOCUMENTS', avg(documents(i), legal(i))),
      ];
      break;
    }
    case 'PHARMACY_V1':
      factors = [
        f(
          'compliance',
          'Compliance',
          40,
          'DOCUMENTS',
          avg(documents(i), i.pharmacistActive ? { completion: 1, hint: null } : { completion: 0, hint: 'Add a registered pharmacist' }, legal(i)),
        ),
        f('ops', 'Operations', 30, 'OPERATIONS', avg(prep(i), hours(i), bank(i))),
        f(
          'training',
          'Training',
          30,
          'TRAINING',
          i.trainingDone ? { completion: 1, hint: null } : { completion: 0, hint: 'Finish the training, quiz and test order' },
        ),
      ];
      break;
    case 'LAB_V1':
      factors = [
        f(
          'compliance',
          'Compliance',
          40,
          'DOCUMENTS',
          avg(documents(i), i.pathologistActive ? { completion: 1, hint: null } : { completion: 0, hint: 'Add the pathologist who signs reports' }, legal(i)),
        ),
        f('tests', 'Tests & packages', 25, 'CATALOG', catalog(i, 5, false)),
        f(
          'collection',
          'Sample collection',
          20,
          'OPERATIONS',
          avg(i.completedSteps.includes('OPERATIONS') ? { completion: 1, hint: null } : { completion: 0, hint: 'Choose home collection, walk-in or both' }, hours(i)),
        ),
        f('bank', 'Bank account', 15, 'BANK', bank(i)),
      ];
      break;
    case 'VENDOR_V1':
      factors = [
        f('location', 'Location', 40, 'OUTLET', location(i)),
        f('catalog', 'Items', 30, 'CATALOG', catalog(i, 3, false)),
        f('hours', 'Hours', 30, 'OUTLET', hours(i)),
      ];
      break;
  }

  const score = Math.round(factors.reduce((s, x) => s + x.points, 0));
  const gate: ReadinessGate = score >= 80 ? 'LIVE' : score >= 60 ? 'LIMITED' : 'BLOCKED';
  return { score, gate, factors };
}

const DOC_LABELS: Partial<Record<DocumentType, string>> = {
  FSSAI: 'FSSAI licence',
  GSTIN: 'GST certificate',
  PAN: 'PAN card',
  DRUG_LICENSE_DL20: 'Drug licence (Form 20)',
  DRUG_LICENSE_DL21: 'Drug licence (Form 21)',
  PHARMACIST_REGISTRATION: 'Pharmacist registration',
  NABL_CERTIFICATE: 'NABL accreditation certificate',
  CLINICAL_ESTABLISHMENT_REG: 'Clinical establishment registration',
  PATHOLOGIST_REGISTRATION: 'Pathologist registration',
  ADDRESS_PROOF: 'Address proof',
  BANK_PROOF: 'Cancelled cheque / bank proof',
  SHOP_ESTABLISHMENT: 'Shop & establishment certificate',
  TRADE_LICENSE: 'Trade licence',
  LANDMARK_PHOTO: 'Storefront photo',
};

export const docLabel = (t: DocumentType) => DOC_LABELS[t] ?? t;
