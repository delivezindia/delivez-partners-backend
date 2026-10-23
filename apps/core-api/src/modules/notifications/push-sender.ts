import { Injectable, Logger } from '@nestjs/common';

export interface PushMessage {
  title: string;
  body: string;
  /** Path to open on click, e.g. /stores/:id/orders/DEL-123. */
  url: string;
  /** Same tag replaces the previous notification instead of stacking. */
  tag: string;
  /** New orders stay on screen until tapped and go out with high priority. */
  urgent?: boolean;
  data?: Record<string, string>;
}

export type PushResult = 'SENT' | 'INVALID_TOKEN' | 'FAILED' | 'LOGGED';
export type PushPlatform = 'WEB' | 'ANDROID' | 'IOS';

export interface PushSenderStatus {
  mode: 'firebase' | 'log';
  projectId: string | null;
  /** Human explanation when not sending (shown on the admin status page). */
  problem: string | null;
}

/** Delivers one message to one device token. The Firebase (FCM) implementation plugs in here. */
export abstract class PushSender {
  abstract get enabled(): boolean;
  abstract send(token: string, platform: PushPlatform, message: PushMessage): Promise<PushResult>;

  describe(): PushSenderStatus {
    return { mode: 'log', projectId: null, problem: 'Push messages are only written to the server log' };
  }

  /** Proves the setup works end to end without messaging anyone (Firebase: get a Google access token). */
  async verify(): Promise<{ ok: boolean; error?: string }> {
    return { ok: false, error: this.describe().problem ?? 'Push is not configured' };
  }
}

/** Local dev: prints the push instead of sending it. */
@Injectable()
export class LogPushSender extends PushSender {
  private readonly logger = new Logger('Push');
  get enabled() {
    return false;
  }

  async send(token: string, platform: PushPlatform, m: PushMessage): Promise<PushResult> {
    this.logger.log(`[PUSH ${platform} …${token.slice(-8)}] ${m.title} — ${m.body} (${m.url})`);
    return 'LOGGED';
  }
}
