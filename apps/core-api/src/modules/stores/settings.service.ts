import { HttpStatus, Injectable } from '@nestjs/common';
import type { Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { isWithinHours, nextOpening } from '../../common/hours';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from '../onboarding/onboarding.service';
import type { SettingsInput, TimingInput } from './settings.schemas';

/** Fields a partner may change after onboarding; everything else goes through admin/compliance. */
const SETTINGS_FIELDS = [
  'description',
  'cuisines',
  'whatsappPhone',
  'email',
  'logoUrl',
  'coverUrl',
  'supportsDelivery',
  'supportsPickup',
  'deliveryRadiusKm',
  'expressEnabled',
  'defaultPrepMinutes',
  'peakPrepMinutes',
  'acceptMultipleOrders',
  'allowSubstitutions',
  'maxOrdersPerHour',
  'autoPauseOverloaded',
  'autoAcceptOrders',
  'minOrderAmount',
  'packagingFee',
  'collectionFee',
  'aiPrepEnabled',
  'aiAlertsEnabled',
  'aiAutoExtendEta',
  'aiMenuAutoPause',
  'aiAggressiveness',
  'allowGenericSubstitution',
  'contactIfRxUnclear',
] as const;

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventBus,
  ) {}

  async get(storeId: string) {
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      include: {
        city: { select: { name: true, state: true, timezone: true } },
        zone: { select: { name: true } },
        timings: { orderBy: [{ dayOfWeek: 'asc' }, { opensAt: 'asc' }] },
        holidays: { where: { date: { gte: startOfToday() } }, orderBy: { date: 'asc' } },
      },
    });
    const tz = store.city?.timezone ?? 'Asia/Kolkata';
    const now = new Date();
    return {
      store,
      hours: {
        openNow: isWithinHours(store.timings, store.holidays.map((h) => h.date), now, tz),
        nextOpening: nextOpening(store.timings, now, tz),
        timezone: tz,
      },
    };
  }

  async update(storeId: string, input: SettingsInput, actor: Actor) {
    const before = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const data: Prisma.StoreUpdateInput = {};
    for (const key of SETTINGS_FIELDS) {
      if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
    }
    const prep = input.defaultPrepMinutes ?? before.defaultPrepMinutes;
    const peak = input.peakPrepMinutes ?? before.peakPrepMinutes;
    if (peak < prep) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Peak prep time should be at least the normal prep time', { fieldErrors: { peakPrepMinutes: ['Must be ≥ normal prep time'] } });
    const delivery = input.supportsDelivery ?? before.supportsDelivery;
    const pickup = input.supportsPickup ?? before.supportsPickup;
    if (!delivery && !pickup) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Offer delivery, pickup or both', { fieldErrors: { supportsDelivery: ['Choose at least one'] } });
    if (before.vertical !== 'EAT') {
      delete data.packagingFee;
      delete data.cuisines;
    }
    if (before.vertical !== 'DIAGNOSTICS') delete data.collectionFee;
    if (before.vertical !== 'PHARMACY') {
      delete data.allowGenericSubstitution;
      delete data.contactIfRxUnclear;
    }

    const changed = Object.keys(data).filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((data as Record<string, unknown>)[k]));
    if (!changed.length) return this.get(storeId);

    await this.prisma.$transaction(async (tx) => {
      await tx.store.update({ where: { id: storeId }, data });
      await this.audit.log(
        {
          actorUserId: actor.userId,
          actorType: 'USER',
          entity: 'Store',
          entityId: storeId,
          action: 'UPDATE',
          before: pick(before, changed),
          after: pick(data as Record<string, unknown>, changed),
          ip: actor.ip,
        },
        tx,
      );
      await this.events.publish(tx, { type: 'store.settings_updated', data: { storeId, fields: changed }, actor: { type: 'PARTNER', userId: actor.userId }, correlationId: actor.correlationId });
    });
    return this.get(storeId);
  }

  /** Replaces the weekly schedule. Several slots per day are allowed (split shifts) but may not overlap. */
  async replaceTimings(storeId: string, timings: TimingInput[], actor: Actor) {
    for (let d = 0; d < 7; d++) {
      const day = timings.filter((t) => t.dayOfWeek === d).sort((a, b) => a.opensAt.localeCompare(b.opensAt));
      for (let i = 1; i < day.length; i++) {
        if (day[i].opensAt < day[i - 1].closesAt) {
          throw new ApiError(HttpStatus.BAD_REQUEST, 'TIMINGS_OVERLAP', 'Two time slots on the same day overlap');
        }
      }
    }
    if (timings.length === 0) throw new ApiError(HttpStatus.BAD_REQUEST, 'TIMINGS_REQUIRED', 'Keep at least one open slot; use holidays to close for a day');

    const before = await this.prisma.storeTiming.findMany({ where: { storeId } });
    await this.prisma.$transaction(async (tx) => {
      await tx.storeTiming.deleteMany({ where: { storeId } });
      await tx.storeTiming.createMany({ data: timings.map((t) => ({ storeId, ...t })) });
      await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'StoreTiming', entityId: storeId, action: 'UPDATE', before, after: timings, ip: actor.ip }, tx);
      await this.events.publish(tx, { type: 'store.hours_updated', data: { storeId }, actor: { type: 'PARTNER', userId: actor.userId }, correlationId: actor.correlationId });
    });
    return this.get(storeId);
  }

  async addHoliday(storeId: string, date: string, reason: string | undefined, actor: Actor) {
    const day = new Date(`${date}T00:00:00.000Z`);
    if (day < startOfToday()) throw new ApiError(HttpStatus.BAD_REQUEST, 'HOLIDAY_IN_PAST', 'Pick today or a future date');
    await this.prisma.storeHoliday.upsert({
      where: { storeId_date: { storeId, date: day } },
      update: { reason: reason ?? null },
      create: { storeId, date: day, reason: reason ?? null },
    });
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'StoreHoliday', entityId: storeId, action: 'CREATE', after: { date, reason }, ip: actor.ip });
    return this.get(storeId);
  }

  async removeHoliday(storeId: string, holidayId: string, actor: Actor) {
    const res = await this.prisma.storeHoliday.deleteMany({ where: { id: holidayId, storeId } });
    if (!res.count) throw new ApiError(HttpStatus.NOT_FOUND, 'HOLIDAY_NOT_FOUND', 'Holiday not found');
    await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'StoreHoliday', entityId: holidayId, action: 'DELETE', ip: actor.ip });
    return this.get(storeId);
  }

  async bank(storeId: string) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { partnerAccountId: true, settlementCycle: true, commissionPct: true } });
    const bank = await this.prisma.bankAccount.findFirst({ where: { partnerAccountId: store.partnerAccountId, isPrimary: true } });
    return {
      settlementCycle: store.settlementCycle,
      commissionPct: store.commissionPct,
      account: bank
        ? {
            accountHolderName: bank.accountHolderName,
            accountNumberLast4: bank.accountNumberLast4,
            ifsc: bank.ifsc,
            bankName: bank.bankName,
            upiId: bank.upiId,
            verificationStatus: bank.verificationStatus,
            createdAt: bank.createdAt,
          }
        : null,
    };
  }
}

function startOfToday() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function pick(obj: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, obj[k]]));
}
