import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';

// A server secret from the environment. Development falls back to a fixed value; production never uses a value
// that's visible in the code: if the variable is missing it derives one from JWT_PRIVATE_KEY (required there, and
// secret) and warns, so a missing line in .env can't make file links or OTP hashes guessable.
export function serverSecret(name: string, devValue: string, env: Record<string, string | undefined> = process.env): string {
  const set = env[name];
  if (set) return set;
  if (env.NODE_ENV !== 'production') return devValue;
  const jwt = env.JWT_PRIVATE_KEY;
  if (!jwt) throw new Error(`${name} (or JWT_PRIVATE_KEY) is required in production`);
  new Logger('Secrets').warn(`${name} is not set: using a value derived from JWT_PRIVATE_KEY. Set ${name} in .env.`);
  return createHmac('sha256', jwt).update(`delivez:${name}`).digest('hex');
}
