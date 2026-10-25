// What the partner's browser read off a document (digital PDF text or OCR), kept for the reviewer.
// The browser is not trusted — these are hints that tell compliance where to look twice.

export interface DocReadingInput {
  method: 'pdf-text' | 'ocr';
  documentNumber: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  confidence: 'HIGH' | 'LOW' | 'NONE';
  engineConfidence: number | null;
}

export type ReadingFlag = 'NOT_READ' | 'NUMBER_CHANGED' | 'EXPIRY_CHANGED' | 'GSTIN_MISMATCH' | 'PAN_MISMATCH' | 'LOW_QUALITY';

const norm = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[\s.]/g, '');

/** The ocrData row: what was read, and what doesn't add up. */
export function readingRecord(
  type: string,
  reading: DocReadingInput | undefined,
  saved: { documentNumber?: string | null; expiresAt?: Date | null },
  accountGstin: string | null,
) {
  if (!reading) return { provider: 'none' };
  const flags: ReadingFlag[] = [];
  if (reading.confidence === 'NONE') flags.push('NOT_READ');
  if (reading.method === 'ocr' && reading.engineConfidence != null && reading.engineConfidence < 60) flags.push('LOW_QUALITY');
  if (reading.documentNumber && saved.documentNumber && norm(reading.documentNumber) !== norm(saved.documentNumber)) flags.push('NUMBER_CHANGED');
  const savedExpiry = saved.expiresAt ? saved.expiresAt.toISOString().slice(0, 10) : null;
  if (reading.expiresAt && savedExpiry && reading.expiresAt !== savedExpiry) flags.push('EXPIRY_CHANGED');
  const number = norm(saved.documentNumber || reading.documentNumber);
  const gstin = norm(accountGstin);
  if (gstin && number) {
    if (type === 'GSTIN' && number !== gstin) flags.push('GSTIN_MISMATCH');
    // A GSTIN contains the business PAN (characters 3–12).
    if (type === 'PAN' && gstin.length === 15 && number !== gstin.slice(2, 12)) flags.push('PAN_MISMATCH');
  }
  return {
    provider: reading.method === 'pdf-text' ? 'pdf-text' : 'tesseract',
    read: { documentNumber: reading.documentNumber, issuedAt: reading.issuedAt, expiresAt: reading.expiresAt },
    confidence: reading.confidence,
    engineConfidence: reading.engineConfidence,
    flags,
  };
}

/** What the admin console shows: null when nothing was read (older uploads, OTHER documents). */
export function readingView(ocrData: unknown) {
  const o = (ocrData ?? {}) as { provider?: string; read?: { documentNumber: string | null; issuedAt: string | null; expiresAt: string | null }; confidence?: string; engineConfidence?: number | null; flags?: ReadingFlag[] };
  if (!o.provider || o.provider === 'none') return null;
  return { method: o.provider, read: o.read ?? null, confidence: o.confidence ?? 'NONE', engineConfidence: o.engineConfidence ?? null, flags: o.flags ?? [] };
}
