import { createSign } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { PushSender, type PushMessage, type PushPlatform, type PushResult } from './push-sender';

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
// src/ and dist/ are both 5 levels below the repo root here.
const DEFAULT_KEY_PATH = resolve(__dirname, '../../../../../secrets/firebase-service-account.json');

/**
 * Firebase Cloud Messaging (HTTP v1): one sender for web, Android and iOS device tokens.
 * Reads the service account from FIREBASE_SERVICE_ACCOUNT_PATH or secrets/firebase-service-account.json.
 * If neither exists it behaves like the log sender, so local dev works without keys.
 */
@Injectable()
export class FcmPushSender extends PushSender {
  private readonly logger = new Logger('Push');
  private readonly account: ServiceAccount | null;
  private problem: string | null = null;
  private cached: { token: string; exp: number } | null = null;

  constructor() {
    super();
    this.account = this.load();
    if (this.account) this.logger.log(`Sending push via Firebase project ${this.account.project_id}`);
    else this.logger.warn('No Firebase service account found — push messages are logged, not sent');
  }

  get enabled() {
    return !!this.account;
  }

  private load(): ServiceAccount | null {
    const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH ? resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH) : DEFAULT_KEY_PATH;
    if (!existsSync(path)) {
      this.problem = `Firebase key file not found. Put it at ${path} and restart the API (pm2 restart delivez-api).`;
      return null;
    }
    try {
      const a = JSON.parse(readFileSync(path, 'utf8')) as ServiceAccount;
      if (a.project_id && a.client_email && a.private_key) return a;
      this.problem = `Firebase key file at ${path} is missing project_id, client_email or private_key — download a fresh key.`;
      return null;
    } catch {
      this.logger.error(`Firebase service account at ${path} is not valid JSON`);
      this.problem = `Firebase key file at ${path} is not valid JSON — download a fresh key.`;
      return null;
    }
  }

  describe() {
    return { mode: this.account ? ('firebase' as const) : ('log' as const), projectId: this.account?.project_id ?? null, problem: this.problem };
  }

  async verify() {
    if (!this.account) return { ok: false, error: this.problem ?? 'Firebase key not loaded' };
    try {
      this.cached = null; // force a fresh exchange: proves key, clock and network right now
      await this.accessToken();
      return { ok: true };
    } catch (e) {
      const msg = (e as Error).message;
      const hint = /invalid_grant/i.test(msg)
        ? ' — the key was deleted/rotated in Firebase, or the server clock is wrong (check: timedatectl).'
        : /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT/i.test(msg)
          ? ' — the server cannot reach oauth2.googleapis.com (outgoing HTTPS blocked?).'
          : '';
      return { ok: false, error: msg + hint };
    }
  }

  /** Google OAuth access token from a self-signed JWT; cached until 5 minutes before it expires. */
  private async accessToken(): Promise<string> {
    if (this.cached && this.cached.exp > Date.now() + 300_000) return this.cached.token;
    const a = this.account!;
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: a.client_email, scope: SCOPE, aud: a.token_uri ?? TOKEN_URI, iat: now, exp: now + 3600 })}`;
    const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(a.private_key, 'base64url')}`;
    const res = await fetch(a.token_uri ?? TOKEN_URI, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !body.access_token) throw new Error(`Google token exchange failed (${res.status}): ${body.error_description ?? 'no detail'}`);
    this.cached = { token: body.access_token, exp: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  async send(token: string, platform: PushPlatform, m: PushMessage): Promise<PushResult> {
    if (!this.account) {
      this.logger.log(`[PUSH ${platform} …${token.slice(-8)}] ${m.title} — ${m.body} (${m.url})`);
      return 'LOGGED';
    }
    // Web: data-only, drawn by our service worker (click target, tag, sticky new orders).
    // Phones: a notification block so the OS shows it even when the app is closed.
    const data = { ...m.data, title: m.title, body: m.body, url: m.url, tag: m.tag, urgent: m.urgent ? '1' : '0' };
    const message: Record<string, unknown> = { token, data };
    if (platform === 'WEB') {
      message.webpush = { headers: { Urgency: m.urgent ? 'high' : 'normal', TTL: m.urgent ? '300' : '86400' } };
    } else {
      message.notification = { title: m.title, body: m.body };
      message.android = { priority: m.urgent ? 'HIGH' : 'NORMAL', ttl: m.urgent ? '300s' : '86400s', notification: { tag: m.tag, channel_id: m.urgent ? 'orders' : 'default', sound: 'default' } };
      message.apns = { headers: { 'apns-priority': m.urgent ? '10' : '5', 'apns-collapse-id': m.tag.slice(0, 64) }, payload: { aps: { sound: 'default' } } };
    }
    try {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${this.account.project_id}/messages:send`, {
        method: 'POST',
        headers: { authorization: `Bearer ${await this.accessToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      if (res.ok) return 'SENT';
      const err = (await res.json().catch(() => ({}))) as { error?: { status?: string; message?: string; details?: { errorCode?: string }[] } };
      const code = err.error?.details?.find((d) => d.errorCode)?.errorCode ?? err.error?.status;
      // Token no longer valid (app uninstalled, browser data cleared, permission revoked) → caller deactivates it.
      if (res.status === 404 || code === 'UNREGISTERED' || (code === 'INVALID_ARGUMENT' && /registration token/i.test(err.error?.message ?? ''))) return 'INVALID_TOKEN';
      this.logger.warn(`FCM send failed (${res.status} ${code ?? ''}): ${err.error?.message ?? ''}`);
      return 'FAILED';
    } catch (e) {
      this.logger.warn(`FCM send error: ${(e as Error).message}`);
      return 'FAILED';
    }
  }
}
