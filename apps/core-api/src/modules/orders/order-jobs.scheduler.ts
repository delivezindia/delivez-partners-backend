import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrderStateService } from './order-state.service';
import { SubstitutionsService } from './substitutions.service';
import { ReturnsService } from './returns.service';
import { ACCEPT_TIMEOUT_SECONDS, RX_REVIEW_MINUTES } from './orders.service';
import { KvService } from '../../common/kv/kv.service';
import { EventBus } from '../../events/event-bus.service';
import { CANCEL_TEXT, SLA, type SlaBreach } from './sla';
import { OpsAlertsService } from './ops-alerts.service';

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
    private readonly returns: ReturnsService,
    private readonly kv: KvService,
    private readonly events: EventBus,
    private readonly opsAlerts: OpsAlertsService,
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
        where: {
          status: 'PLACED',
          placedAt: {
            lt: new Date(now.getTime() - ACCEPT_TIMEOUT_SECONDS * 1000),
          },
        },
        select: { id: true },
        take: 100,
      });
      for (const o of expired) {
        await this.state
          .transition(
            o.id,
            'REJECT',
            { kind: 'SYSTEM' },
            {
              reason: CANCEL_TEXT.ACCEPT_TIMEOUT,
              code: 'ACCEPT_TIMEOUT',
              meta: { auto: 'ACCEPT_TIMEOUT' },
            },
          )
          .catch((e) => this.logger.debug(`timeout skip ${o.id}: ${(e as Error).message}`));
      }
      const rxExpired = await this.prisma.order.findMany({
        where: {
          status: 'AWAITING_RX_REVIEW',
          createdAt: {
            lt: new Date(now.getTime() - RX_REVIEW_MINUTES * 60_000),
          },
        },
        select: { id: true },
        take: 100,
      });
      for (const o of rxExpired) {
        await this.state
          .transition(
            o.id,
            'CANCEL',
            { kind: 'SYSTEM' },
            {
              reason: CANCEL_TEXT.RX_TIMEOUT,
              code: 'RX_TIMEOUT',
              meta: { auto: 'RX_REVIEW_TIMEOUT' },
              inTx: async (tx, order) => {
                if (order.prescriptionId)
                  await tx.prescription.update({
                    where: { id: order.prescriptionId },
                    data: { status: 'EXPIRED' },
                  });
              },
            },
          )
          .catch((e) => this.logger.debug(`rx timeout skip ${o.id}: ${(e as Error).message}`));
      }
      await this.substitutions.expireDue(now);
      await this.returns.expireDue(now);
      const toPrepare = await this.prisma.order.findMany({
        where: {
          status: 'ACCEPTED',
          acceptedAt: {
            lt: new Date(now.getTime() - AUTO_PREPARING_SECONDS * 1000),
          },
        },
        select: { id: true },
        take: 100,
      });
      for (const o of toPrepare) {
        await this.state
          .transition(o.id, 'START_PREPARING', { kind: 'SYSTEM' }, { meta: { auto: 'AUTO_PREPARING' } })
          .catch((e) => this.logger.debug(`preparing skip ${o.id}: ${(e as Error).message}`));
      }
      await this.slaWatch(now);
      await this.opsAlerts.sync(now);
    } catch (err) {
      this.logger.error(`Order jobs tick failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  /**
   * SLA watch: alerts, no state change. Each breach fires once per order.
   * PREP_LATE → the shop · PREP_STUCK / NO_RIDER / DOOR_WAIT → city ops, who decide (call, reassign, cancel with a code).
   */
  private async slaWatch(now: Date) {
    const min = (d: Date | null | undefined) => (d ? Math.floor((now.getTime() - d.getTime()) / 60_000) : 0);
    const breaches: {
      orderId: string;
      storeId: string;
      cityId: string | null;
      orderNumber: string;
      kind: SlaBreach;
      minutes: number;
    }[] = [];

    const kitchen = await this.prisma.order.findMany({
      where: {
        status: { in: ['ACCEPTED', 'PREPARING', 'READY_SOON'] },
        acceptedAt: { not: null },
        isTestOrder: false,
      },
      select: {
        id: true,
        storeId: true,
        orderNumber: true,
        acceptedAt: true,
        promisedPrepMinutes: true,
        store: { select: { cityId: true } },
      },
      take: 300,
    });
    for (const o of kitchen) {
      const due = new Date(o.acceptedAt!.getTime() + (o.promisedPrepMinutes ?? 20) * 60_000);
      const late = min(due);
      const base = {
        orderId: o.id,
        storeId: o.storeId,
        cityId: o.store.cityId,
        orderNumber: o.orderNumber,
        minutes: late,
      };
      if (late >= SLA.PREP_STUCK_MINUTES) breaches.push({ ...base, kind: 'PREP_STUCK' });
      else if (late >= SLA.PREP_LATE_MINUTES) breaches.push({ ...base, kind: 'PREP_LATE' });
    }

    const waiting = await this.prisma.order.findMany({
      where: {
        isTestOrder: false,
        OR: [
          {
            status: 'READY',
            fulfilmentType: 'DELIVERY',
            readyAt: {
              lt: new Date(now.getTime() - SLA.NO_RIDER_MINUTES * 60_000),
            },
            deliveryTask: { status: { in: ['CREATED', 'SEARCHING_RIDER'] } },
          },
          {
            status: 'ARRIVED',
            deliveryTask: {
              arrivedDropAt: {
                lt: new Date(now.getTime() - SLA.DOOR_WAIT_MINUTES * 60_000),
              },
            },
          },
        ],
      },
      select: {
        id: true,
        storeId: true,
        orderNumber: true,
        status: true,
        readyAt: true,
        deliveryTask: { select: { arrivedDropAt: true } },
        store: { select: { cityId: true } },
      },
      take: 300,
    });
    for (const o of waiting) {
      const door = o.status === 'ARRIVED';
      breaches.push({
        orderId: o.id,
        storeId: o.storeId,
        cityId: o.store.cityId,
        orderNumber: o.orderNumber,
        kind: door ? 'DOOR_WAIT' : 'NO_RIDER',
        minutes: min(door ? o.deliveryTask?.arrivedDropAt : o.readyAt),
      });
    }

    for (const b of breaches) {
      if (!(await this.kv.setIfAbsent(`sla:${b.kind}:${b.orderId}`, '1', 24 * 3600))) continue;
      await this.prisma.$transaction((tx) =>
        this.events.publish(tx, {
          type: 'order.sla_breach',
          data: b,
          actor: { type: 'SYSTEM' },
        }),
      );
    }
  }
}
