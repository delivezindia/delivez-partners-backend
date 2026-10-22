// Prints fresh production secrets as .env lines for the BACKEND (deploy/backend/.env).
// Run once:  node scripts/generate-secrets.mjs   — paste the output into deploy/backend/.env. Never commit it. Re-running makes NEW keys (existing logins and encrypted bank
// numbers stop working), so only do it for a fresh install.
import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const oneLine = (pem) => pem.trim().replace(/\n/g, '\\n');
const token = (n = 32) => randomBytes(n).toString('base64url');

console.log(`# --- generated ${new Date().toISOString()} ---`);
console.log(`POSTGRES_PASSWORD=${token(24)}`);
console.log(`JWT_PRIVATE_KEY="${oneLine(privateKey)}"`);
console.log(`JWT_PUBLIC_KEY="${oneLine(publicKey)}"`);
console.log(`BANK_ENC_KEY=${randomBytes(32).toString('base64')}`);
console.log(`OTP_PEPPER=${token()}`);
console.log(`FILE_URL_SECRET=${token()}`);
console.log(`ORDER_QR_SECRET=${token()}`);
