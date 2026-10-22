import { HttpStatus, Injectable } from '@nestjs/common';
import { publicApiUrl } from '../../common/public-url';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import { ApiError } from '../../common/api-exception.filter';

export const ALLOWED_UPLOAD_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const URL_TTL_SECONDS = 15 * 60;

interface UploadClaims {
  k: string; // file key
  t: string; // content type
  m: number; // max bytes
  e: number; // expiry (unix seconds)
  op: 'put' | 'get';
}

/**
 * Local-disk object storage that mimics pre-signed S3 URLs (plan §5.2), so clients already use
 * the presign → PUT → register flow. Replace with an S3/R2 driver for staging/production.
 */
@Injectable()
export class StorageService {
  private readonly root = resolve(process.env.UPLOAD_DIR ?? resolve(__dirname, '../../../uploads'));
  private readonly secret = process.env.FILE_URL_SECRET ?? 'dev-file-url-secret';

  presignUpload(prefix: string, contentType: string, size: number) {
    const ext = ALLOWED_UPLOAD_TYPES[contentType];
    if (!ext) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_TYPE_NOT_ALLOWED', 'Upload a JPG, PNG, WEBP or PDF file');
    if (size > MAX_UPLOAD_BYTES) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_TOO_LARGE', 'Files must be 10 MB or smaller');
    const fileKey = `${prefix}/${randomUUID()}.${ext}`;
    const token = this.sign({ k: fileKey, t: contentType, m: MAX_UPLOAD_BYTES, e: this.expiry(), op: 'put' });
    return { fileKey, uploadUrl: publicApiUrl(`/v1/files/upload?token=${token}`), method: 'PUT', headers: { 'content-type': contentType }, expiresIn: URL_TTL_SECONDS };
  }

  /** Short-lived read link. Health data (lab reports, prescriptions) uses a shorter TTL. */
  signedReadUrl(fileKey: string, ttlSeconds = URL_TTL_SECONDS) {
    const token = this.sign({ k: fileKey, t: '', m: 0, e: Math.floor(Date.now() / 1000) + ttlSeconds, op: 'get' });
    return publicApiUrl(`/v1/files/raw?token=${token}`);
  }

  /** Server-side write (generated documents, dev fixtures). Returns the SHA-256. */
  putFile(fileKey: string, data: Buffer) {
    const path = this.pathFor(fileKey);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    return createHash('sha256').update(data).digest('hex');
  }

  /** Streams an upload body to disk, enforcing the signed content type and size. Returns the SHA-256. */
  async writeUpload(token: string, contentType: string | undefined, body: Readable): Promise<{ fileKey: string; size: number; sha256: string }> {
    const claims = this.verify(token, 'put');
    if ((contentType ?? '').split(';')[0] !== claims.t) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_TYPE_MISMATCH', 'Content type does not match the upload request');
    }
    const path = this.pathFor(claims.k);
    mkdirSync(dirname(path), { recursive: true });
    const hash = createHash('sha256');
    let size = 0;

    await new Promise<void>((ok, fail) => {
      const out = createWriteStream(path);
      body.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > claims.m) {
          body.destroy();
          out.destroy();
          fail(new ApiError(HttpStatus.PAYLOAD_TOO_LARGE, 'FILE_TOO_LARGE', 'Files must be 10 MB or smaller'));
          return;
        }
        hash.update(chunk);
      });
      body.on('error', fail);
      out.on('error', fail);
      out.on('finish', ok);
      body.pipe(out);
    }).catch((err) => {
      if (existsSync(path)) unlinkSync(path);
      throw err;
    });

    if (size === 0) {
      unlinkSync(path);
      throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_EMPTY', 'The file is empty');
    }
    return { fileKey: claims.k, size, sha256: hash.digest('hex') };
  }

  openRead(token: string) {
    const claims = this.verify(token, 'get');
    return this.openKey(claims.k);
  }

  /** Opens a stored file by key (callers decide whether the key may be served). */
  openKey(fileKey: string) {
    const path = this.pathFor(fileKey);
    if (!existsSync(path)) throw new ApiError(HttpStatus.NOT_FOUND, 'FILE_NOT_FOUND', 'File not found');
    const ext = path.split('.').pop()!;
    const contentType = Object.entries(ALLOWED_UPLOAD_TYPES).find(([, e]) => e === ext)?.[0] ?? 'application/octet-stream';
    return { stream: createReadStream(path), contentType, size: statSync(path).size };
  }

  /** Hash of a stored file, or null when it was never uploaded. */
  async hashOf(fileKey: string): Promise<string | null> {
    const path = this.pathFor(fileKey);
    if (!existsSync(path)) return null;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
    return hash.digest('hex');
  }

  private pathFor(fileKey: string) {
    const path = resolve(this.root, fileKey);
    if (!path.startsWith(this.root + sep)) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_KEY_INVALID', 'Invalid file');
    return path;
  }

  private expiry() {
    return Math.floor(Date.now() / 1000) + URL_TTL_SECONDS;
  }

  private sign(claims: UploadClaims) {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return `${body}.${createHmac('sha256', this.secret).update(body).digest('base64url')}`;
  }

  private verify(token: string, op: UploadClaims['op']): UploadClaims {
    const [body, sig] = (token ?? '').split('.');
    const expected = body ? createHmac('sha256', this.secret).update(body).digest('base64url') : '';
    const valid = sig && sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!valid) throw new ApiError(HttpStatus.FORBIDDEN, 'FILE_URL_INVALID', 'This link is invalid');
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as UploadClaims;
    if (claims.op !== op || claims.e < Date.now() / 1000) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'FILE_URL_EXPIRED', 'This link has expired');
    }
    return claims;
  }
}
