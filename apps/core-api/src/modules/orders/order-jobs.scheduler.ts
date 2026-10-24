import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStateService } from './order-state.service';
import { SubstitutionsService } from './substitutions.service';
import { ACCEPT_TIMEOUT_SECONDS, RX_REVIEW_MINUTES } from './orders.service';

const TICK_MS = 5_000;
/** Accepted orders move to Preparing on their own after this (plan §10: auto-PREPARING after 60 s). */
export const AUTO_PREPARING_SECONDS = 60;

/**
 * Order timers: unaccepted orders are rejected after 3 minutes (customer refunded), prescriptions not
 * reviewed in 15 minutes are cancelled (refunded), accepted orders start "preparing" after 60 s. Each move goes through OrderStateService, so a store action that
 * lands first simply wins (the job's transition then fails the rule check and is skipped).
 */
@Injectable()
export class OrderJobsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OrderJobsScheduler.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly state: OrderStateService,
    private readonly substitutions: SubstitutionsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_SCHEDULERS === 'true') return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      const expired = await this.prisma.order.findMany({
        where: { status: 'PLACED', placedAt: { lt: new Date(now.getTime() - ACCEPT_TIMEOUT_SECONDS * 1000) } },
        select: { id: true },
        take: 100,
      });
      for (const o of expired) {
        await this.state
          .transition(o.id, 'REJECT', { kind: 'SYSTEM' }, { reason: 'Not accepted within 3 minutes', meta: { auto: 'ACCEPT_TIMEOUT' } })
          .catch((e) => this.logger.debug(`timeout skip ${o.id}: ${(e as Error).message}`));
      }
      const rxExpired = await this.prisma.order.findMany({
        where: { status: 'AWAITING_RX_REVIEW', createdAt: { lt: new Date(now.getTime() - RX_REVIEW_MINUTES * 60_000) } },
        select: { id: true },
        take: 100,
      });
      for (const o of rxExpired) {
        await this.state
          .transition(o.id, 'CANCEL', { kind: 'SYSTEM' }, {
            reason: `Prescription not reviewed within ${RX_REVIEW_MINUTES} minutes`,
            meta: { auto: 'RX_REVIEW_TIMEOUT' },
            inTx: async (tx, order) => {
              if (order.prescriptionId) await tx.prescription.update({ where: { id: order.prescriptionId }, data: { status: 'EXPIRED' } });
            },
          })
          .catch((e) => this.logger.debug(`rx timeout skip ${o.id}: ${(e as Error).message}`));
      }
      await this.substitutions.expireDue(now);
      const toPrepare = await this.prisma.order.findMany({
        where: { status: 'ACCEPTED', acceptedAt: { lt: new Date(now.getTime() - AUTO_PREPARING_SECONDS * 1000) } },
        select: { id: true },
        take: 100,
      });
      for (const o of toPrepare) {
        await this.state
          .transition(o.id, 'START_PREPARING', { kind: 'SYSTEM' }, { meta: { auto: 'AUTO_PREPARING' } })
          .catch((e) => this.logger.debug(`preparing skip ${o.id}: ${(e as Error).message}`));
      }
    } catch (err) {
      this.logger.error(`Order jobs tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
