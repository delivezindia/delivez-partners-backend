import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { isWithinHours } from '../../common/hours';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';

/** closedReason written when the scheduler (not the partner) closes a store. */
export const AUTO_CLOSED = 'AUTO_HOURS';
const TICK_MS = 60_000;

/**
 * Auto-closes live stores outside their timings/holidays and reopens them at opening time
 * if the scheduler was the one that closed them (plan §5.5). A partner's manual CLOSED is never overridden.
 * Single-instance for now; becomes a BullMQ repeatable job when workers are split out.
 */
@Injectable()
export class OpenStateScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpenStateScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const stores = await this.prisma.store.findMany({
        where: { status: { in: ['LIVE', 'LIMITED'] } },
        select: {
          id: true,
          openState: true,
          closedReason: true,
          city: { select: { timezone: true } },
          timings: { select: { dayOfWeek: true, opensAt: true, closesAt: true, isClosed: true } },
          holidays: { select: { date: true } },
        },
      });
      for (const s of stores) {
        if (!s.timings.length) continue;
        const open = isWithinHours(s.timings, s.holidays.map((h) => h.date), now, s.city?.timezone ?? 'Asia/Kolkata');
        if (!open && s.openState !== 'CLOSED') await this.set(s.id, s.openState, 'CLOSED', AUTO_CLOSED);
        else if (open && s.openState === 'CLOSED' && s.closedReason === AUTO_CLOSED) await this.set(s.id, 'CLOSED', 'OPEN', null);
      }
    } catch (err) {
      this.logger.error(`Open-state tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  private async set(storeId: string, from: string, to: 'OPEN' | 'CLOSED', reason: string | null) {
    await this.prisma.$transaction(async (tx) => {
      // Conditional update so a partner's change between read and write wins.
      const res = await tx.store.updateMany({ where: { id: storeId, openState: from as 'OPEN' | 'BUSY' | 'CLOSED' }, data: { openState: to, closedReason: reason } });
      if (!res.count) return;
      await this.events.publish(tx, {
        type: 'store.open_state_changed',
        data: { storeId, from, to, reason: to === 'CLOSED' ? 'Outside opening hours' : 'Opening hours started' },
        actor: { type: 'SYSTEM' },
      });
    });
  }
}
