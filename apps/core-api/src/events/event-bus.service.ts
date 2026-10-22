import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@delivez/db';
import { PrismaService } from '../prisma/prisma.service';

// Event envelope (plan §11.2)
export interface DomainEvent<T = Record<string, unknown>> {
  id: string;
  type: string;
  occurredAt: string;
  correlationId?: string;
  actor?: { type: string; userId?: string; role?: string };
  data: T;
  version: number;
}

export interface PublishInput<T> {
  type: string;
  data: T;
  actor?: DomainEvent['actor'];
  correlationId?: string;
}

type Handler = (event: DomainEvent) => void | Promise<void>;

const RELAY_INTERVAL_MS = 500;
const RELAY_BATCH = 100;

/**
 * Transactional outbox: publish() writes to `outbox` inside the caller's transaction;
 * a relay loop dispatches committed rows to subscribers and marks them published.
 * Delivery is at-least-once, so handlers must be idempotent.
 */
@Injectable()
export class EventBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventBus.name);
  private readonly emitter = new EventEmitter();
  private timer?: NodeJS.Timeout;
  private relaying = false;

  constructor(private readonly prisma: PrismaService) {
    this.emitter.setMaxListeners(100);
  }

  /** Write an event in the same transaction as the state change. */
  async publish<T extends object>(tx: Prisma.TransactionClient, input: PublishInput<T>): Promise<DomainEvent<T>> {
    const event: DomainEvent<T> = {
      id: randomUUID(),
      type: input.type,
      occurredAt: new Date().toISOString(),
      correlationId: input.correlationId,
      actor: input.actor,
      data: input.data,
      version: 1,
    };
    await tx.outbox.create({
      data: {
        id: event.id,
        type: event.type,
        payload: event as unknown as Prisma.InputJsonValue,
        correlationId: event.correlationId,
      },
    });
    return event;
  }

  /** Subscribe to an exact type ("order.ready"), a prefix ("order.*") or everything ("*"). */
  subscribe(pattern: string, handler: Handler): () => void {
    const listener = (event: DomainEvent) => {
      if (!matches(pattern, event.type)) return;
      Promise.resolve(handler(event)).catch((err) =>
        this.logger.error(`Handler for ${pattern} failed on ${event.type}: ${err?.stack ?? err}`),
      );
    };
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.relay(), RELAY_INTERVAL_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async relay() {
    if (this.relaying) return;
    this.relaying = true;
    try {
      // SKIP LOCKED lets several API/worker instances relay without double-dispatching a row.
      const rows = await this.prisma.$transaction(async (tx) => {
        const batch = await tx.$queryRaw<{ id: string; payload: DomainEvent }[]>`
          SELECT id, payload FROM outbox
          WHERE "publishedAt" IS NULL
          ORDER BY "createdAt"
          LIMIT ${RELAY_BATCH}
          FOR UPDATE SKIP LOCKED`;
        if (batch.length) {
          await tx.outbox.updateMany({
            where: { id: { in: batch.map((r) => r.id) } },
            data: { publishedAt: new Date() },
          });
        }
        return batch;
      });
      for (const row of rows) this.emitter.emit('event', row.payload);
    } catch (err) {
      this.logger.error(`Outbox relay failed: ${(err as Error).message}`);
    } finally {
      this.relaying = false;
    }
  }
}

function matches(pattern: string, type: string) {
  if (pattern === '*') return true;
  if (pattern.endsWith('.*')) return type.startsWith(pattern.slice(0, -1));
  return pattern === type;
}
