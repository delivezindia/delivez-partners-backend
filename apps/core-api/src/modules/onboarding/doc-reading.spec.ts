import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readingRecord, readingView } from './doc-reading';

const read = { method: 'pdf-text' as const, documentNumber: '10021041000123', issuedAt: '2024-04-01', expiresAt: '2029-03-31', confidence: 'HIGH' as const, engineConfidence: null };

describe('document reading flags', () => {
  it('clean reading', () => {
    const r = readingRecord('FSSAI', read, { documentNumber: '10021041000123', expiresAt: new Date('2029-03-31T00:00:00Z') }, null);
    assert.deepEqual(r.flags, []);
    assert.equal(r.provider, 'pdf-text');
  });
  it('partner changed what was read', () => {
    const r = readingRecord('FSSAI', read, { documentNumber: '10021041000999', expiresAt: new Date('2030-03-31T00:00:00Z') }, null);
    assert.deepEqual(r.flags, ['NUMBER_CHANGED', 'EXPIRY_CHANGED']);
  });
  it('GSTIN / PAN must match the business GSTIN', () => {
    const g = { ...read, documentNumber: '27AAPFU0939F1ZV' };
    assert.deepEqual(readingRecord('GSTIN', g, { documentNumber: '27AAPFU0939F1ZV' }, '29ABCDE1234F1Z5').flags, ['GSTIN_MISMATCH']);
    assert.deepEqual(readingRecord('PAN', { ...read, documentNumber: 'ABCDE1234F' }, { documentNumber: 'ABCDE1234F' }, '29ABCDE1234F1Z5').flags, []);
    assert.deepEqual(readingRecord('PAN', { ...read, documentNumber: 'ZZZZZ1234F' }, { documentNumber: 'ZZZZZ1234F' }, '29ABCDE1234F1Z5').flags, ['PAN_MISMATCH']);
  });
  it('blurry photo', () => {
    const r = readingRecord('FSSAI', { method: 'ocr', documentNumber: null, issuedAt: null, expiresAt: null, confidence: 'NONE', engineConfidence: 31 }, {}, null);
    assert.deepEqual(r.flags, ['NOT_READ', 'LOW_QUALITY']);
  });
  it('old uploads show nothing', () => {
    assert.equal(readingView({ provider: 'none', note: 'OCR provider not configured yet' }), null);
    assert.equal(readingView(null), null);
  });
});
