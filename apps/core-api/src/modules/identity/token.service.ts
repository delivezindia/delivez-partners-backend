import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createHash, generateKeyPairSync, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import jwt from 'jsonwebtoken';
import type { AppId } from '@delivez/db';

export interface AccessClaims {
  sub: string; // user id
  app: AppId;
  sid: string; // session id
}

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_DAYS = 30;

// RS256 access tokens (plan §4.1). Keys come from JWT_PRIVATE_KEY / JWT_PUBLIC_KEY;
// in dev a key pair is generated once into apps/core-api/.keys (git-ignored).
@Injectable()
export class TokenService implements OnModuleInit {
  private readonly logger = new Logger(TokenService.name);
  private privateKey!: string;
  private publicKey!: string;

  onModuleInit() {
    const envPrivate = process.env.JWT_PRIVATE_KEY?.replace(/\\n/g, '\n');
    const envPublic = process.env.JWT_PUBLIC_KEY?.replace(/\\n/g, '\n');
    if (envPrivate && envPublic) {
      this.privateKey = envPrivate;
      this.publicKey = envPublic;
      return;
    }
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production');
    }
    const dir = resolve(__dirname, '../../../.keys');
    const privPath = resolve(dir, 'jwt-private.pem');
    const pubPath = resolve(dir, 'jwt-public.pem');
    if (!existsSync(privPath) || !existsSync(pubPath)) {
      mkdirSync(dir, { recursive: true });
      const { privateKey, publicKey } = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      writeFileSync(privPath, privateKey);
      writeFileSync(pubPath, publicKey);
      this.logger.warn(`Generated dev JWT key pair in ${dir}`);
    }
    this.privateKey = readFileSync(privPath, 'utf8');
    this.publicKey = readFileSync(pubPath, 'utf8');
  }

  signAccess(claims: AccessClaims): string {
    return jwt.sign(claims, this.privateKey, { algorithm: 'RS256', expiresIn: ACCESS_TTL_SECONDS, issuer: 'delivez-core' });
  }

  /** Throws if the token is invalid or expired. */
  verifyAccess(token: string): AccessClaims {
    const payload = jwt.verify(token, this.publicKey, { algorithms: ['RS256'], issuer: 'delivez-core' });
    return payload as AccessClaims;
  }

  newRefreshToken(): { token: string; hash: string } {
    const token = `rt_${randomBytes(48).toString('base64url')}`;
    return { token, hash: this.hashRefresh(token) };
  }

  hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
