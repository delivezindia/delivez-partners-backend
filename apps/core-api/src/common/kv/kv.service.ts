import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

// Small key-value facade used for rate limits, idempotency and short-lived caches.
// Uses Redis when REDIS_URL is set; otherwise an in-process map (dev only — not shared across instances).
@Injectable()
export class KvService implements OnModuleDestroy {
  private readonly logger = new Logger(KvService.name);
  private readonly redis?: Redis;
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();

  constructor() {
    const url = process.env.REDIS_URL;
    if (url) {
      this.redis = new Redis(url, { maxRetriesPerRequest: 2 });
      this.logger.log('Using Redis');
    } else {
      this.logger.warn('REDIS_URL not set — using in-memory KV (dev only)');
    }
  }

  get mode(): 'redis' | 'memory' {
    return this.redis ? 'redis' : 'memory';
  }

  /** For the admin status page: is Redis reachable? (memory mode is always 'ok'.) */
  async ping(): Promise<boolean> {
    if (!this.redis) return true;
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.redis) return this.redis.get(key);
    const hit = this.memory.get(key);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return hit.value;
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<void> {
    if (this.redis) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
      return;
    }
    this.memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** Sets only if absent. Returns true when the key was set. */
  async setIfAbsent(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    if (this.redis) return (await this.redis.set(key, value, 'EX', ttlSeconds, 'NX')) === 'OK';
    if ((await this.get(key)) !== null) return false;
    await this.set(key, value, ttlSeconds);
    return true;
  }

  /** Increments a counter; the TTL starts with the first increment of the window. */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    if (this.redis) {
      const n = await this.redis.incr(key);
      if (n === 1) await this.redis.expire(key, ttlSeconds);
      return n;
    }
    const current = await this.get(key);
    const n = (current ? Number(current) : 0) + 1;
    const expiresAt = current ? this.memory.get(key)!.expiresAt : Date.now() + ttlSeconds * 1000;
    this.memory.set(key, { value: String(n), expiresAt });
    return n;
  }

  async ttl(key: string): Promise<number> {
    if (this.redis) return this.redis.ttl(key);
    const hit = this.memory.get(key);
    return hit ? Math.max(0, Math.ceil((hit.expiresAt - Date.now()) / 1000)) : -2;
  }

  async del(key: string): Promise<void> {
    if (this.redis) await this.redis.del(key);
    else this.memory.delete(key);
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }
}
