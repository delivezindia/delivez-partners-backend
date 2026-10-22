import { Logger } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// AES-256-GCM for bank account numbers (plan §5.3). Key: BANK_ENC_KEY = base64 of 32 random bytes.
// Production should source this from KMS; dev falls back to a fixed derived key.
let key: Buffer | undefined;

function getKey(): Buffer {
  if (key) return key;
  const fromEnv = process.env.BANK_ENC_KEY;
  if (fromEnv) {
    key = Buffer.from(fromEnv, 'base64');
    if (key.length !== 32) throw new Error('BANK_ENC_KEY must be 32 bytes (base64)');
  } else {
    if (process.env.NODE_ENV === 'production') throw new Error('BANK_ENC_KEY is required in production');
    new Logger('Crypto').warn('BANK_ENC_KEY not set — using a dev-only key');
    key = createHash('sha256').update('delivez-dev-bank-key').digest();
  }
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', getKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64')}`;
}

export function decryptSecret(enc: string): string {
  const raw = Buffer.from(enc.replace(/^v1\./, ''), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', getKey(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

const NOISE = new Set(['m', 's', 'ms', 'mr', 'mrs', 'shri', 'smt', 'pvt', 'private', 'ltd', 'limited', 'llp', 'the', 'and', 'co']);

function tokens(name: string) {
  return new Set(
    name
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !NOISE.has(t)),
  );
}

/** 0..1 similarity of two person/business names (token overlap). */
export function nameMatchScore(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return Math.round((common / Math.min(ta.size, tb.size)) * 100) / 100;
}
