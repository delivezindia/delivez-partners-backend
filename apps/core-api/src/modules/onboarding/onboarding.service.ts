import { HttpStatus, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DocumentType, OnboardingChannel, Prisma, StoreType } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { nameMatchScore } from '../../common/crypto';
import { encodeGeohash, haversineKm } from '../../common/geo';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { GeoService } from '../geo/geo.service';
import {
  FLOWS,
  flowFor,
  optionalDocuments,
  PARTNER_LEGAL_TYPES,
  PHARMACY_QUIZ,
  PHARMACY_QUIZ_PASS,
  requiredDocuments,
  STEP_SCHEMAS,
  type FlowVersion,
  type StepKey,
  type StepPayload,
} from './flows';
import { computeReadiness, docLabel, type Readiness } from './readiness';

export interface Actor {
  userId: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
  channel?: OnboardingChannel;
}

export interface Warning {
  code: string;
  message: string;
}

const EDITABLE_STATUSES = ['DRAFT', 'NEEDS_CHANGES'] as const;
const SKIPPED_KEY = '_skipped';

type StoreWithRelations = Prisma.StoreGetPayload<{
  include: {
    onboarding: true;
    city: true;
    zone: true;
    timings: true;
    pharmacists: { include: { shifts: true } };
    pathologists: true;
    documents: true;
    partnerAccount: { include: { bankAccounts: true } };
  };
}>;

@Injectable()
export class OnboardingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly geo: GeoService,
    private readonly storage: StorageService,
  ) {}

  // -------------------------------------------------------------------
  // Start
  // -------------------------------------------------------------------

  async start(input: { storeType: StoreType; businessName: string; channel: OnboardingChannel; referralCode?: string; entryPoint?: string }, actor: Actor) {
    const { flowVersion, vertical, partnerType } = flowFor(input.storeType);
    const steps = FLOWS[flowVersion];

    const storeId = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId } });

      // An owner adding another outlet keeps one partner account (legal entity); otherwise create one.
      const ownerMembership = await tx.partnerMember.findFirst({
        where: { userId: user.id, role: 'OWNER', isActive: true },
        orderBy: { createdAt: 'asc' },
      });
      const partnerAccountId =
        ownerMembership?.partnerAccountId ??
        (
          await tx.partnerAccount.create({
            data: {
              legalName: input.businessName,
              displayName: input.businessName,
              partnerType,
              contactPhone: user.phone,
              members: { create: { userId: user.id, role: 'OWNER', storeIds: [], acceptedAt: new Date() } },
            },
          })
        ).id;

      const salesAgent = input.referralCode
        ? await tx.adminUser.findFirst({ where: { role: 'SALES_AGENT', isActive: true, user: { phone: input.referralCode } } })
        : null;

      const store = await tx.store.create({
        data: {
          partnerAccountId,
          name: input.businessName,
          slug: slugify(input.businessName, cryptoSuffix()),
          vertical,
          storeType: input.storeType,
          phone: user.phone,
          supportsDelivery: true,
          onboarding: {
            create: {
              channel: input.channel,
              flowVersion,
              currentStep: steps[0].key,
              completedSteps: [],
              stepData: {},
              referralCode: input.referralCode,
              salesAgentId: salesAgent?.id,
              entryPoint: input.entryPoint ?? (input.referralCode ? 'SALES_LINK' : 'WEBSITE_CTA'),
              events: { create: { step: steps[0].key, action: 'STARTED', actorType: 'PARTNER' } },
            },
          },
        },
      });

      await this.audit.log({ actorUserId: user.id, actorType: 'USER', entity: 'Store', entityId: store.id, action: 'CREATE', after: { name: store.name, storeType: store.storeType }, ip: actor.ip }, tx);
      await this.events.publish(tx, {
        type: 'onboarding.started',
        data: { storeId: store.id, flowVersion, storeType: input.storeType, channel: input.channel },
        actor: { type: 'PARTNER', userId: user.id, role: 'OWNER' },
        correlationId: actor.correlationId,
      });
      return store.id;
    });

    return this.view(storeId);
  }

  // -------------------------------------------------------------------
  // Read model for the wizard
  // -------------------------------------------------------------------

  async view(storeId: string) {
    const store = await this.loadStore(storeId);
    const session = store.onboarding;
    if (!session) throw new ApiError(HttpStatus.NOT_FOUND, 'ONBOARDING_NOT_FOUND', 'This store has no onboarding session');

    const flowVersion = session.flowVersion as FlowVersion;
    const stepData = (session.stepData ?? {}) as Record<string, unknown>;
    const skipped = (stepData[SKIPPED_KEY] as string[] | undefined) ?? [];
    const steps = FLOWS[flowVersion].map((s) => ({
      ...s,
      status: session.completedSteps.includes(s.key) ? 'DONE' : skipped.includes(s.key) ? 'SKIPPED' : 'TODO',
    }));
    const countable = steps.filter((s) => s.key !== 'REVIEW');
    const progressPct = Math.round((countable.filter((s) => s.status === 'DONE').length / countable.length) * 100);

    const [readiness, products, legal, adminEvents] = await Promise.all([
      this.readinessFor(store),
      this.prisma.product.findMany({
        where: { storeId, deletedAt: null },
        select: {
          id: true,
          name: true,
          price: true,
          mrp: true,
          isVeg: true,
          unit: true,
          prescriptionRequired: true,
          drugSchedule: true,
          category: { select: { name: true } },
          inventory: { select: { stockQty: true, trackStock: true } },
          labSampleType: true,
          labFastingHours: true,
          labReportHours: true,
          labHomeCollection: true,
          labWalkIn: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      this.legalStatus(store),
      this.prisma.onboardingEvent.findMany({
        where: { sessionId: session.id, actorType: 'ADMIN' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { action: true, meta: true, createdAt: true },
      }),
    ]);

    const required = requiredDocuments(store.storeType);
    const latestDocs = latestPerType(store.documents);
    const bank = store.partnerAccount.bankAccounts.find((b) => b.isPrimary) ?? null;
    const pharmacist = store.pharmacists.find((p) => p.isActive) ?? null;
    const pathologist = store.pathologists.find((p) => p.isActive) ?? null;

    return {
      session: {
        id: session.id,
        storeId,
        flowVersion,
        channel: session.channel,
        status: session.status,
        currentStep: session.currentStep,
        completedSteps: session.completedSteps,
        steps,
        progressPct,
        stepData: omit(stepData, SKIPPED_KEY),
        trainingDone: session.trainingDone,
        quizScore: session.quizScore,
        submittedAt: session.submittedAt,
      },
      store: {
        id: store.id,
        name: store.name,
        slug: store.slug,
        vertical: store.vertical,
        storeType: store.storeType,
        status: store.status,
        description: store.description,
        cuisines: store.cuisines,
        phone: store.phone,
        whatsappPhone: store.whatsappPhone,
        email: store.email,
        addressLine1: store.addressLine1,
        addressLine2: store.addressLine2,
        landmark: store.landmark,
        pincode: store.pincode,
        lat: store.lat,
        lng: store.lng,
        addressConfidence: store.addressConfidence,
        city: store.city ? { id: store.city.id, name: store.city.name, state: store.city.state } : null,
        zone: store.zone ? { id: store.zone.id, name: store.zone.name } : null,
        timings: store.timings
          .map((t) => ({ dayOfWeek: t.dayOfWeek, opensAt: t.opensAt, closesAt: t.closesAt }))
          .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.opensAt.localeCompare(b.opensAt)),
        defaultPrepMinutes: store.defaultPrepMinutes,
        peakPrepMinutes: store.peakPrepMinutes,
        aiPrepEnabled: store.aiPrepEnabled,
        supportsDelivery: store.supportsDelivery,
        supportsPickup: store.supportsPickup,
        deliveryRadiusKm: store.deliveryRadiusKm,
        acceptMultipleOrders: store.acceptMultipleOrders,
        allowSubstitutions: store.allowSubstitutions,
        maxOrdersPerHour: store.maxOrdersPerHour,
        autoPauseOverloaded: store.autoPauseOverloaded,
        packagingFee: store.packagingFee,
        allowGenericSubstitution: store.allowGenericSubstitution,
        contactIfRxUnclear: store.contactIfRxUnclear,
        selfPackagingConfirmed: store.selfPackagingConfirmed,
        commissionPct: store.commissionPct,
        settlementCycle: store.settlementCycle,
        deliveryFeeBearer: store.deliveryFeeBearer,
        readinessScore: store.readinessScore,
      },
      partnerAccount: {
        id: store.partnerAccount.id,
        legalName: store.partnerAccount.legalName,
        partnerType: store.partnerAccount.partnerType,
        gstin: store.partnerAccount.gstin,
      },
      documents: {
        required: required.map((type) => ({ type, label: docLabel(type) })),
        optional: optionalDocuments(store.storeType).map((type) => ({ type, label: docLabel(type) })),
        uploaded: latestDocs.map((d) => ({
          id: d.id,
          type: d.type,
          label: docLabel(d.type),
          status: d.status,
          documentNumber: d.documentNumber,
          expiresAt: d.expiresAt,
          rejectionReason: d.rejectionReason,
          createdAt: d.createdAt,
          viewUrl: this.storage.signedReadUrl(d.fileUrl),
        })),
      },
      bank: bank
        ? {
            id: bank.id,
            accountHolderName: bank.accountHolderName,
            accountNumberLast4: bank.accountNumberLast4,
            ifsc: bank.ifsc,
            bankName: bank.bankName,
            upiId: bank.upiId,
            verificationStatus: bank.verificationStatus,
            nameMatchScore: bank.nameMatchScore,
          }
        : null,
      pharmacist: pharmacist
        ? {
            id: pharmacist.id,
            name: pharmacist.name,
            registrationNo: pharmacist.registrationNo,
            stateCouncil: pharmacist.stateCouncil,
            shifts: pharmacist.shifts.map((s) => ({ dayOfWeek: s.dayOfWeek, startsAt: s.startsAt, endsAt: s.endsAt })),
          }
        : null,
      pathologist: pathologist
        ? { id: pathologist.id, name: pathologist.name, qualification: pathologist.qualification, registrationNo: pathologist.registrationNo, stateCouncil: pathologist.stateCouncil }
        : null,
      catalog: {
        count: products.length,
        products: products.map(({ labSampleType, labFastingHours, labReportHours, labHomeCollection, labWalkIn, ...p }) => ({
          ...p,
          lab: labSampleType != null ? { sampleType: labSampleType, fastingHours: labFastingHours, reportHours: labReportHours, homeCollection: labHomeCollection, walkIn: labWalkIn } : null,
        })),
      },
      legal,
      quiz:
        flowVersion === 'PHARMACY_V1'
          ? PHARMACY_QUIZ.map((q) => ({ question: q.question, options: q.options }))
          : null,
      readiness,
      // Decisions by the Delivez team, newest first (reasons are written for the partner).
      reviewNotes: adminEvents.map((e) => {
        const meta = (e.meta ?? {}) as { reason?: string; to?: string };
        return { action: e.action, reason: meta.reason ?? null, to: meta.to ?? null, at: e.createdAt };
      }),
    };
  }

  // -------------------------------------------------------------------
  // Save / skip a step
  // -------------------------------------------------------------------

  async saveStep(storeId: string, step: StepKey, rawPayload: unknown, actor: Actor) {
    const store = await this.loadStore(storeId);
    const session = this.editableSession(store);
    const flow = FLOWS[session.flowVersion as FlowVersion];
    if (!flow.some((s) => s.key === step) || step === 'REVIEW') {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'STEP_NOT_IN_FLOW', `Step ${step} is not part of this onboarding`);
    }

    const parsed = STEP_SCHEMAS[step].safeParse(rawPayload ?? {});
    if (!parsed.success) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Please check the highlighted fields', parsed.error.flatten());
    }

    const warnings: Warning[] = [];
    let saved: Record<string, unknown> = parsed.data as Record<string, unknown>;

    await this.prisma.$transaction(async (tx) => {
      saved = (await this.applyStep(tx, store, step, parsed.data, actor, warnings)) ?? saved;

      const stepData = { ...((session.stepData ?? {}) as Record<string, unknown>) };
      stepData[step] = saved;
      stepData[SKIPPED_KEY] = ((stepData[SKIPPED_KEY] as string[] | undefined) ?? []).filter((s) => s !== step);
      const completedSteps = Array.from(new Set([...session.completedSteps, step]));

      await tx.onboardingSession.update({
        where: { id: session.id },
        data: {
          stepData: stepData as Prisma.InputJsonValue,
          completedSteps,
          currentStep: nextStep(flow.map((s) => s.key), step, completedSteps, stepData[SKIPPED_KEY] as string[]),
          events: { create: { step, action: 'COMPLETED', actorType: 'PARTNER', meta: warnings.length ? ({ warnings } as unknown as Prisma.InputJsonValue) : undefined } },
        },
      });
    });

    await this.refreshReadiness(storeId);
    return { ...(await this.view(storeId)), warnings };
  }

  async skipStep(storeId: string, step: StepKey) {
    const store = await this.loadStore(storeId);
    const session = this.editableSession(store);
    const flow = FLOWS[session.flowVersion as FlowVersion];
    const def = flow.find((s) => s.key === step);
    if (!def?.optional) throw new ApiError(HttpStatus.BAD_REQUEST, 'STEP_NOT_SKIPPABLE', 'This step is required');

    const stepData = { ...((session.stepData ?? {}) as Record<string, unknown>) };
    const skipped = Array.from(new Set([...((stepData[SKIPPED_KEY] as string[] | undefined) ?? []), step]));
    stepData[SKIPPED_KEY] = skipped;
    await this.prisma.onboardingSession.update({
      where: { id: session.id },
      data: {
        stepData: stepData as Prisma.InputJsonValue,
        currentStep: nextStep(flow.map((s) => s.key), step, session.completedSteps, skipped),
        events: { create: { step, action: 'SKIPPED', actorType: 'PARTNER' } },
      },
    });
    return this.view(storeId);
  }

  // -------------------------------------------------------------------
  // Submit
  // -------------------------------------------------------------------

  async submit(storeId: string, actor: Actor) {
    const store = await this.loadStore(storeId);
    const session = this.editableSession(store);
    const flow = FLOWS[session.flowVersion as FlowVersion];

    const problems: string[] = [];
    for (const s of flow) {
      if (s.key !== 'REVIEW' && !s.optional && !session.completedSteps.includes(s.key)) problems.push(`Complete "${s.title}"`);
    }
    if (!store.addressLine1 || store.lat == null || store.lng == null || !store.cityId || !store.pincode) problems.push('Pin your outlet location');
    if (!store.phone) problems.push('Add a store phone number');

    const readiness = await this.readinessFor(store);
    if (store.vertical === 'PHARMACY') {
      const uploaded = new Set(latestPerType(store.documents).filter((d) => d.status !== 'REJECTED' && d.status !== 'EXPIRED').map((d) => d.type));
      const missing = requiredDocuments(store.storeType).filter((t) => !uploaded.has(t));
      if (missing.length) problems.push(`Upload ${missing.map(docLabel).join(', ')}`);
      if (!store.pharmacists.some((p) => p.isActive)) problems.push('Add a registered pharmacist');
    }
    if (store.vertical === 'DIAGNOSTICS') {
      const uploaded = new Set(latestPerType(store.documents).filter((d) => d.status !== 'REJECTED' && d.status !== 'EXPIRED').map((d) => d.type));
      const missing = requiredDocuments(store.storeType).filter((t) => !uploaded.has(t));
      if (missing.length) problems.push(`Upload ${missing.map(docLabel).join(', ')}`);
      if (!store.pathologists.some((p) => p.isActive)) problems.push('Add the pathologist who signs reports');
    }
    if (readiness.gate === 'BLOCKED') {
      problems.push(...readiness.factors.filter((f) => f.hint).map((f) => f.hint!));
    }
    if (problems.length) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'ONBOARDING_INCOMPLETE', 'A few things are still needed before you can submit', {
        problems: Array.from(new Set(problems)),
        readiness,
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.onboardingSession.update({
        where: { id: session.id },
        data: {
          status: 'SUBMITTED',
          submittedAt: new Date(),
          currentStep: 'REVIEW',
          readinessBreakdown: readiness as unknown as Prisma.InputJsonValue,
          events: { create: { step: 'REVIEW', action: 'SUBMITTED', actorType: 'PARTNER', meta: { score: readiness.score, gate: readiness.gate } } },
        },
      });
      await tx.store.update({ where: { id: storeId }, data: { status: 'SUBMITTED', readinessScore: readiness.score } });
      await this.audit.log(
        { actorUserId: actor.userId, actorType: 'USER', entity: 'Store', entityId: storeId, action: 'STATUS_CHANGE', before: { status: store.status }, after: { status: 'SUBMITTED' }, ip: actor.ip },
        tx,
      );
      await this.events.publish(tx, {
        type: 'onboarding.submitted',
        data: { storeId, flowVersion: session.flowVersion, readinessScore: readiness.score, gate: readiness.gate, cityId: store.cityId },
        actor: { type: 'PARTNER', userId: actor.userId },
        correlationId: actor.correlationId,
      });
    });

    return this.view(storeId);
  }

  async removeProduct(storeId: string, productId: string) {
    const store = await this.loadStore(storeId);
    this.editableSession(store);
    const result = await this.prisma.product.updateMany({ where: { id: productId, storeId, deletedAt: null }, data: { deletedAt: new Date(), isAvailable: false } });
    if (!result.count) throw new ApiError(HttpStatus.NOT_FOUND, 'PRODUCT_NOT_FOUND', 'Item not found');
    await this.refreshReadiness(storeId);
    return this.view(storeId);
  }

  /** Recomputes and stores the readiness score (after steps, documents, bank changes). */
  async refreshReadiness(storeId: string): Promise<Readiness | null> {
    const store = await this.loadStore(storeId);
    // Stores created outside the onboarding flow (seeded / migrated) have no session to score.
    if (!store.onboarding) return null;
    const readiness = await this.readinessFor(store);
    await this.prisma.store.update({ where: { id: storeId }, data: { readinessScore: readiness.score } });
    if (store.onboarding) {
      await this.prisma.onboardingSession.update({
        where: { id: store.onboarding.id },
        data: { readinessBreakdown: readiness as unknown as Prisma.InputJsonValue },
      });
    }
    return readiness;
  }

  // -------------------------------------------------------------------
  // Step handlers — each writes the denormalised columns (plan §5.1.2)
  // -------------------------------------------------------------------

  private async applyStep(
    tx: Prisma.TransactionClient,
    store: StoreWithRelations,
    step: StepKey,
    data: unknown,
    actor: Actor,
    warnings: Warning[],
  ): Promise<Record<string, unknown> | void> {
    switch (step) {
      case 'ELIGIBILITY': {
        const d = data as StepPayload<'ELIGIBILITY'>;
        if (d.hoursPerDay < 6) {
          throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'ELIGIBILITY_HOURS', 'Stores need to be open at least 6 hours a day to join Delivez');
        }
        if (store.vertical === 'PHARMACY' && (!d.hasDrugLicense || !d.hasPharmacist)) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'ELIGIBILITY_PHARMACY',
            'A valid drug licence (Form 20/21) and a registered pharmacist are required to sell medicines on Delivez',
          );
        }
        if (store.vertical === 'DIAGNOSTICS' && (!d.hasNablAccreditation || !d.hasPathologist)) {
          throw new ApiError(
            HttpStatus.UNPROCESSABLE_ENTITY,
            'ELIGIBILITY_LAB',
            'Labs on Delivez need NABL accreditation and a registered pathologist who signs every report',
          );
        }
        const pin = await this.geo.pincode(d.pincode);
        if (!pin.serviceable) {
          warnings.push({ code: 'PINCODE_NOT_LIVE', message: "We're not delivering in this PIN code yet. You can still register and we'll switch you on at launch." });
        }
        await tx.store.update({ where: { id: store.id }, data: { supportsDelivery: d.homeDelivery, supportsPickup: true } });
        return;
      }

      case 'BASIC_DETAILS': {
        const d = data as StepPayload<'BASIC_DETAILS'>;
        const otherStores = await tx.store.count({ where: { partnerAccountId: store.partnerAccountId, id: { not: store.id } } });
        await tx.store.update({
          where: { id: store.id },
          data: {
            name: d.storeName,
            slug: store.status === 'DRAFT' ? slugify(d.storeName, store.id.slice(0, 6)) : undefined,
            description: d.description ?? null,
            cuisines: store.vertical === 'EAT' ? (d.cuisines ?? []) : [],
            whatsappPhone: d.whatsappPhone ?? null,
            email: d.email ?? null,
          },
        });
        await tx.partnerAccount.update({
          where: { id: store.partnerAccountId },
          data: {
            legalName: d.legalName ?? (otherStores ? undefined : d.storeName),
            displayName: otherStores ? undefined : d.storeName,
            partnerType: d.partnerType,
            gstin: d.gstin ?? undefined,
            contactEmail: d.email ?? undefined,
            whatsappPhone: d.whatsappPhone ?? undefined,
          },
        });
        await tx.user.update({ where: { id: actor.userId }, data: { fullName: d.ownerName } });
        return;
      }

      case 'OUTLET': {
        const d = data as StepPayload<'OUTLET'>;
        const loc = await this.geo.resolveLocation(d.lat, d.lng, d.pincode);
        if (!loc.serviceable) {
          warnings.push({ code: 'OUTSIDE_LIVE_ZONES', message: `You're outside our current delivery zones in ${loc.cityName}. You'll go live as soon as we launch in your area.` });
        }
        if (loc.confidence !== 'HIGH') {
          warnings.push({ code: 'ADDRESS_CONFIDENCE_LOW', message: 'The map pin and PIN code don’t fully match. Our team may call to confirm your location.' });
        }
        const nearby = await tx.store.findMany({
          where: { id: { not: store.id }, pincode: d.pincode, status: { notIn: ['REJECTED', 'CLOSED'] } },
          select: { name: true, lat: true, lng: true },
        });
        if (nearby.some((s) => s.lat != null && s.lng != null && haversineKm(d.lat, d.lng, s.lat, s.lng) < 0.2 && nameMatchScore(s.name, store.name) >= 0.8)) {
          warnings.push({ code: 'DUPLICATE_SUSPECTED', message: 'A store with a similar name is already registered here. Our team will check before approval.' });
        }

        await tx.store.update({
          where: { id: store.id },
          data: {
            addressLine1: d.addressLine1,
            addressLine2: d.addressLine2 ?? null,
            landmark: d.landmark ?? null,
            pincode: d.pincode,
            lat: d.lat,
            lng: d.lng,
            geohash: encodeGeohash(d.lat, d.lng, 7),
            cityId: loc.cityId,
            zoneId: loc.zoneId,
            addressConfidence: loc.confidence,
          },
        });
        const unique = new Map(d.timings.map((t) => [`${t.dayOfWeek}-${t.opensAt}`, t]));
        await tx.storeTiming.deleteMany({ where: { storeId: store.id } });
        await tx.storeTiming.createMany({ data: [...unique.values()].map((t) => ({ storeId: store.id, ...t })) });
        return { ...d, derived: { cityId: loc.cityId, city: loc.cityName, zone: loc.zoneName, addressConfidence: loc.confidence } };
      }

      case 'DOCUMENTS': {
        const uploaded = new Set(
          latestPerType(store.documents)
            .filter((x) => x.status !== 'REJECTED' && x.status !== 'EXPIRED')
            .map((x) => x.type),
        );
        const missing = requiredDocuments(store.storeType).filter((t) => !uploaded.has(t));
        if (missing.length) {
          throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'DOCUMENTS_MISSING', `Upload ${missing.map(docLabel).join(', ')} to continue`, { missing });
        }
        return { uploaded: [...uploaded] };
      }

      case 'PHARMACIST': {
        const d = data as StepPayload<'PHARMACIST'>;
        const clash = await tx.pharmacist.findFirst({
          where: { registrationNo: d.registrationNo, stateCouncil: d.stateCouncil, storeId: { not: store.id }, isActive: true },
        });
        if (clash) {
          throw new ApiError(HttpStatus.CONFLICT, 'PHARMACIST_ALREADY_REGISTERED', 'This pharmacist registration is already linked to another pharmacy');
        }
        const existing = store.pharmacists[0];
        const pharmacist = existing
          ? await tx.pharmacist.update({
              where: { id: existing.id },
              data: { name: d.name, registrationNo: d.registrationNo, stateCouncil: d.stateCouncil, isActive: true, consentAt: new Date() },
            })
          : await tx.pharmacist.create({
              data: { storeId: store.id, name: d.name, registrationNo: d.registrationNo, stateCouncil: d.stateCouncil, consentAt: new Date() },
            });
        await tx.pharmacistShift.deleteMany({ where: { pharmacistId: pharmacist.id } });
        await tx.pharmacistShift.createMany({ data: d.shifts.map((s) => ({ pharmacistId: pharmacist.id, ...s })) });
        return { pharmacistId: pharmacist.id, name: d.name };
      }

      case 'PATHOLOGIST': {
        const d = data as StepPayload<'PATHOLOGIST'>;
        const existing = store.pathologists[0];
        const fields = { name: d.name, qualification: d.qualification, registrationNo: d.registrationNo.toUpperCase(), stateCouncil: d.stateCouncil, isActive: true, consentAt: new Date() };
        const pathologist = existing
          ? await tx.pathologist.update({ where: { id: existing.id }, data: fields })
          : await tx.pathologist.create({ data: { storeId: store.id, ...fields } });
        return { pathologistId: pathologist.id, name: d.name };
      }

      case 'CATALOG': {
        const d = data as StepPayload<'CATALOG'>;
        const lab = store.vertical === 'DIAGNOSTICS';
        const defaultCategory = store.vertical === 'EAT' ? 'Menu' : store.vertical === 'PHARMACY' ? 'Medicines' : lab ? 'Tests' : 'All items';
        const categoryIds = new Map<string, string>();
        for (const item of d.items) {
          if (item.drugSchedule === 'X') {
            throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'SCHEDULE_X_BLOCKED', `"${item.name}" is a Schedule X drug and cannot be sold on Delivez`);
          }
          const categoryName = item.category ?? defaultCategory;
          let categoryId = categoryIds.get(categoryName);
          if (!categoryId) {
            const category = await tx.category.upsert({
              where: { storeId_name: { storeId: store.id, name: categoryName } },
              update: {},
              create: { storeId: store.id, name: categoryName },
            });
            categoryId = category.id;
            categoryIds.set(categoryName, categoryId);
          }
          const rx = (store.vertical === 'PHARMACY' && (item.prescriptionRequired || item.drugSchedule === 'H' || item.drugSchedule === 'H1')) || (lab && !!item.prescriptionRequired);
          const tracksStock = item.stock !== undefined || store.vertical === 'GROCERY' || store.vertical === 'PHARMACY';
          await tx.product.create({
            data: {
              storeId: store.id,
              categoryId,
              name: item.name,
              price: item.price,
              mrp: item.mrp,
              unit: item.unit ?? (store.vertical === 'EAT' ? 'plate' : lab ? 'test' : 'piece'),
              isVeg: store.vertical === 'EAT' ? (item.isVeg ?? null) : null,
              prescriptionRequired: !!rx,
              drugSchedule: store.vertical === 'PHARMACY' ? (item.drugSchedule ?? (rx ? 'H' : 'OTC')) : 'NONE',
              ...(lab
                ? {
                    labSampleType: item.sampleType ?? 'BLOOD',
                    labFastingHours: item.fastingHours ?? 0,
                    labReportHours: item.reportHours ?? 24,
                    labHomeCollection: item.homeCollection ?? true,
                    labWalkIn: item.walkIn ?? true,
                    labParameters: item.parameters ?? null,
                  }
                : {}),
              inventory: tracksStock ? { create: { trackStock: true, stockQty: item.stock ?? 0 } } : undefined,
            },
          });
        }
        const total = await tx.product.count({ where: { storeId: store.id, deletedAt: null } });
        return { itemsAdded: d.items.length, total };
      }

      case 'OPERATIONS': {
        const d = data as StepPayload<'OPERATIONS'>;
        const pharmacy = store.vertical === 'PHARMACY';
        if (pharmacy && !d.selfPackagingConfirmed) {
          throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'PACKAGING_CONFIRMATION', 'Please confirm you will seal and package medicines yourself');
        }
        await tx.store.update({
          where: { id: store.id },
          data: {
            defaultPrepMinutes: d.defaultPrepMinutes,
            peakPrepMinutes: d.peakPrepMinutes,
            aiPrepEnabled: d.aiPrepEnabled,
            supportsDelivery: d.supportsDelivery,
            supportsPickup: d.supportsPickup,
            deliveryRadiusKm: d.deliveryRadiusKm,
            acceptMultipleOrders: d.acceptMultipleOrders,
            allowSubstitutions: d.allowSubstitutions,
            maxOrdersPerHour: d.maxOrdersPerHour ?? null,
            autoPauseOverloaded: d.autoPauseOverloaded,
            packagingFee: store.vertical === 'EAT' ? (d.packagingFee ?? 0) : 0,
            collectionFee: store.vertical === 'DIAGNOSTICS' && d.supportsDelivery ? (d.collectionFee ?? 0) : 0,
            allowGenericSubstitution: pharmacy ? !!d.allowGenericSubstitution : false,
            contactIfRxUnclear: pharmacy ? (d.contactIfRxUnclear ?? true) : true,
            selfPackagingConfirmed: pharmacy ? !!d.selfPackagingConfirmed : false,
          },
        });
        return;
      }

      case 'BANK': {
        const bank = store.partnerAccount.bankAccounts.find((b) => b.isPrimary);
        if (!bank) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'BANK_MISSING', 'Add your bank account or UPI ID first');
        return { bankAccountId: bank.id, verificationStatus: bank.verificationStatus };
      }

      case 'COMMERCIALS':
        return { acknowledged: true, commissionPct: store.commissionPct, settlementCycle: store.settlementCycle, at: new Date().toISOString() };

      case 'LEGAL': {
        const d = data as StepPayload<'LEGAL'>;
        const { required, stateKnown } = await this.legalStatus(store);
        if (!stateKnown) {
          throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'LOCATION_REQUIRED', 'Set your outlet location first — it decides which state terms apply');
        }
        const accepted = new Set(d.acceptedDocIds);
        const missing = required.filter((r) => !accepted.has(r.id));
        if (missing.length) {
          throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'LEGAL_INCOMPLETE', 'Please accept all agreements to continue', { missing: missing.map((m) => m.type) });
        }
        for (const doc of required.filter((r) => !r.accepted)) {
          await tx.consentRecord.create({
            data: {
              userId: actor.userId,
              legalDocId: doc.id,
              storeId: store.id,
              channel: actor.channel ?? store.onboarding!.channel,
              ip: actor.ip,
              userAgent: actor.userAgent?.slice(0, 300),
            },
          });
        }
        return { acceptedDocIds: required.map((r) => r.id), at: new Date().toISOString() };
      }

      case 'TRAINING': {
        const d = data as StepPayload<'TRAINING'>;
        if (!d.videoWatched || !d.practiceOrderDone) {
          throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'TRAINING_INCOMPLETE', 'Watch the video and finish the practice order');
        }
        let quizScore: number | null = null;
        if (store.vertical === 'PHARMACY') {
          quizScore = PHARMACY_QUIZ.reduce((s, q, i) => s + (d.quizAnswers?.[i] === q.answer ? 1 : 0), 0);
          if (quizScore < PHARMACY_QUIZ_PASS) {
            throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'QUIZ_FAILED', `You scored ${quizScore}/${PHARMACY_QUIZ.length}. Review the rules and try again.`, { quizScore });
          }
        }
        await tx.onboardingSession.update({
          where: { id: store.onboarding!.id },
          data: { trainingDone: true, testOrderDone: true, quizScore },
        });
        return { videoWatched: true, practiceOrderDone: true, quizScore };
      }
    }
  }

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  private async loadStore(storeId: string): Promise<StoreWithRelations> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      include: {
        onboarding: true,
        city: true,
        zone: true,
        timings: true,
        pharmacists: { include: { shifts: true } },
        pathologists: true,
        documents: { orderBy: { createdAt: 'desc' } },
        partnerAccount: { include: { bankAccounts: { orderBy: { createdAt: 'desc' } } } },
      },
    });
    if (!store) throw new ApiError(HttpStatus.NOT_FOUND, 'STORE_NOT_FOUND', 'Store not found');
    return store;
  }

  private editableSession(store: StoreWithRelations) {
    const session = store.onboarding;
    if (!session) throw new ApiError(HttpStatus.NOT_FOUND, 'ONBOARDING_NOT_FOUND', 'This store has no onboarding session');
    if (!(EDITABLE_STATUSES as readonly string[]).includes(session.status)) {
      throw new ApiError(HttpStatus.CONFLICT, 'ONBOARDING_LOCKED', 'Your application is with our team. You can still upload documents.');
    }
    return session;
  }

  /** Required partner agreements for a store and whether its owners accepted the current versions. */
  async legalFor(storeId: string) {
    return this.legalStatus(await this.loadStore(storeId));
  }

  /** Records acceptance of updated agreements outside onboarding (the "Review updated terms" sheet). */
  async acceptLegal(storeId: string, acceptedDocIds: string[], actor: Actor) {
    const store = await this.loadStore(storeId);
    const { required } = await this.legalStatus(store);
    const wanted = new Set(acceptedDocIds);
    const toAccept = required.filter((r) => !r.accepted && wanted.has(r.id));
    const stillMissing = required.filter((r) => !r.accepted && !wanted.has(r.id));
    if (stillMissing.length) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'LEGAL_INCOMPLETE', 'Please accept all updated agreements', { missing: stillMissing.map((m) => m.type) });
    }
    await this.prisma.consentRecord.createMany({
      data: toAccept.map((doc) => ({
        userId: actor.userId,
        legalDocId: doc.id,
        storeId,
        channel: actor.channel ?? 'WEB',
        ip: actor.ip,
        userAgent: actor.userAgent?.slice(0, 300),
      })),
    });
    await this.refreshReadiness(storeId);
    return this.legalFor(storeId);
  }

  private async legalStatus(store: StoreWithRelations) {
    const state = store.city?.state ?? null;
    const docs = await this.prisma.legalDocumentVersion.findMany({
      where: {
        isActive: true,
        effectiveFrom: { lte: new Date() },
        OR: [{ type: { in: [...PARTNER_LEGAL_TYPES] } }, ...(state ? [{ type: 'STATE_RIDER' as const, state }] : [])],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    // Latest active version per type.
    const latest = new Map<string, (typeof docs)[number]>();
    for (const d of docs) if (!latest.has(d.type)) latest.set(d.type, d);

    const owners = await this.prisma.partnerMember.findMany({
      where: { partnerAccountId: store.partnerAccountId, role: 'OWNER', isActive: true },
      select: { userId: true },
    });
    const consents = await this.prisma.consentRecord.findMany({
      where: { userId: { in: owners.map((o) => o.userId) }, legalDocId: { in: [...latest.values()].map((d) => d.id) } },
      select: { legalDocId: true, acceptedAt: true },
    });
    const acceptedAt = new Map(consents.map((c) => [c.legalDocId, c.acceptedAt]));

    const required = [...latest.values()].map((d) => ({
      id: d.id,
      type: d.type,
      title: LEGAL_TITLES[d.type] ?? d.type,
      version: d.version,
      state: d.state,
      contentUrl: d.contentUrl,
      accepted: acceptedAt.has(d.id),
      acceptedAt: acceptedAt.get(d.id) ?? null,
    }));
    return { required, stateKnown: !!state, complete: required.length > 0 && required.every((r) => r.accepted) && !!state };
  }

  private async readinessFor(store: StoreWithRelations): Promise<Readiness> {
    const [productsAvailable, productsWithStock, legal] = await Promise.all([
      this.prisma.product.count({ where: { storeId: store.id, deletedAt: null, isAvailable: true } }),
      this.prisma.product.count({ where: { storeId: store.id, deletedAt: null, isAvailable: true, inventory: { stockQty: { gt: 0 } } } }),
      this.legalStatus(store),
    ]);
    const bank = store.partnerAccount.bankAccounts.find((b) => b.isPrimary);
    return computeReadiness({
      flowVersion: store.onboarding!.flowVersion as FlowVersion,
      vertical: store.vertical,
      completedSteps: store.onboarding!.completedSteps,
      addressConfidence: store.addressConfidence,
      maxDailyHours: maxDailyHours(store.timings),
      defaultPrepMinutes: store.defaultPrepMinutes,
      peakPrepMinutes: store.peakPrepMinutes,
      requiredDocTypes: requiredDocuments(store.storeType),
      docs: latestPerType(store.documents),
      productsAvailable,
      productsWithStock,
      bankStatus: bank?.verificationStatus ?? null,
      legalComplete: legal.complete,
      pharmacistActive: store.pharmacists.some((p) => p.isActive && p.consentAt),
      pathologistActive: store.pathologists.some((p) => p.isActive && p.consentAt),
      trainingDone: store.onboarding!.trainingDone,
    });
  }
}

const LEGAL_TITLES: Record<string, string> = {
  PARTNER_TNC: 'Partner Terms & Conditions',
  SLA_TERMS: 'Service Level (SLA) Terms',
  PENALTY_FRAMEWORK: 'Penalty Framework',
  STATE_RIDER: 'State-specific Rider',
};

function latestPerType<T extends { type: DocumentType; createdAt: Date }>(docs: T[]): T[] {
  const seen = new Map<DocumentType, T>();
  for (const d of [...docs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) if (!seen.has(d.type)) seen.set(d.type, d);
  return [...seen.values()];
}

function maxDailyHours(timings: { dayOfWeek: number; opensAt: string; closesAt: string; isClosed: boolean }[]) {
  const perDay = new Map<number, number>();
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  for (const t of timings) {
    if (t.isClosed) continue;
    perDay.set(t.dayOfWeek, (perDay.get(t.dayOfWeek) ?? 0) + Math.max(0, mins(t.closesAt) - mins(t.opensAt)) / 60);
  }
  return Math.max(0, ...perDay.values());
}

function nextStep(order: StepKey[], current: StepKey, completed: string[], skipped: string[] = []): StepKey {
  const idx = order.indexOf(current);
  const pending = (k: StepKey) => !completed.includes(k) && !skipped.includes(k);
  return order.slice(idx + 1).find(pending) ?? order.find((k) => k !== 'REVIEW' && pending(k)) ?? 'REVIEW';
}

function slugify(name: string, suffix: string) {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return `${base || 'store'}-${suffix}`;
}

function cryptoSuffix() {
  return randomUUID().slice(0, 6);
}

function omit<T extends Record<string, unknown>>(obj: T, key: string) {
  const { [key]: _drop, ...rest } = obj;
  return rest;
}
