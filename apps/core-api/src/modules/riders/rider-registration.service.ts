import { HttpStatus, Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { Prisma, RiderApplication, RiderDocument, RiderDocumentType } from '@delivez/db';
import { PrismaService } from '../../prisma/prisma.service';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { StorageService } from '../files/storage.service';
import { requiredDocuments, STEP_NAMES, STEPS, type StepName, type VehicleType } from './rider-options';

/** Where the app should go after login (matches the app's routes). */
export type RiderNext = 'REGISTER' | 'STATUS' | 'HOME' | 'RESTRICTED';

const EDITABLE = ['DRAFT', 'CHANGES_REQUESTED'] as const;
type AppWithDocs = RiderApplication & { rider: { id: string; riderCode: string; status: string; suspendReason: string | null; documents: RiderDocument[] } };

/** What is still missing before the application can be sent. Shared with the admin view. */
export function missingItems(app: RiderApplication, docs: Pick<RiderDocument, 'type' | 'status'>[]) {
  const steps = STEP_NAMES.filter((s) => app[STEPS[s].field] == null);
  const vehicle = (app.legalVehicle as { vehicleType?: VehicleType } | null)?.vehicleType;
  const need = requiredDocuments(vehicle);
  const documents = need.filter((t) => !docs.some((d) => d.type === t && d.status !== 'REJECTED'));
  return { steps, documents, requiredDocuments: need };
}

@Injectable()
export class RiderRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
  ) {}

  /** The rider app calls this right after login to decide the first screen. */
  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, phone: true, fullName: true } });
    const app = await this.load(userId);
    if (!app) return { next: 'REGISTER' as RiderNext, user, rider: null, application: null };
    const r = app.rider;
    const next: RiderNext =
      r.status === 'SUSPENDED' ? 'RESTRICTED' : app.status === 'APPROVED' ? 'HOME' : (EDITABLE as readonly string[]).includes(app.status) ? 'REGISTER' : 'STATUS';
    return {
      next,
      user,
      rider: { id: r.id, riderCode: r.riderCode, status: r.status, restrictedReason: r.status === 'SUSPENDED' ? r.suspendReason : null },
      application: this.view(app),
    };
  }

  /** Opens (or returns) the rider's application. Safe to call twice. */
  async start(userId: string) {
    const existing = await this.load(userId);
    if (existing) return this.view(existing);
    for (let tries = 0; ; tries++) {
      try {
        await this.prisma.rider.create({
          data: { userId, riderCode: `DZR-${String(randomInt(0, 1_000_000)).padStart(6, '0')}`, status: 'ONBOARDING', application: { create: {} } },
        });
        break;
      } catch (e) {
        const code = (e as { code?: string; meta?: { target?: string[] | string } }).code;
        const target = String((e as { meta?: { target?: unknown } }).meta?.target ?? '');
        if (code === 'P2002' && target.includes('userId')) break; // a parallel call created it
        if (code !== 'P2002' || tries > 5) throw e; // riderCode clash: try another number
      }
    }
    const app = (await this.load(userId))!;
    await this.audit.log({ actorUserId: userId, actorType: 'USER', entity: 'RiderApplication', entityId: app.id, action: 'CREATE' });
    return this.view(app);
  }

  async get(userId: string) {
    return this.view(await this.editableOrAny(userId));
  }

  async saveStep(userId: string, step: StepName, body: unknown) {
    const app = await this.editable(userId);
    const parsed = STEPS[step].schema.safeParse(body ?? {});
    if (!parsed.success) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED', 'Please check the highlighted fields', parsed.error.flatten());
    const data: Prisma.RiderApplicationUpdateInput = { [STEPS[step].field]: parsed.data as Prisma.InputJsonValue };
    if (step === 'personal-info') {
      // The service-area pincode decides the city (and which city team reviews the application).
      const pin = await this.prisma.pincode.findUnique({ where: { code: (parsed.data as { pincode: string }).pincode }, select: { cityId: true } });
      data.cityId = pin?.cityId ?? null;
    }
    const saved = await this.prisma.riderApplication.update({ where: { id: app.id }, data });
    return this.view({ ...app, ...saved });
  }

  presignDocument(userId: string, type: RiderDocumentType, contentType: string, size: number) {
    return this.editable(userId).then((app) => ({ type, ...this.storage.presignUpload(`riders/${app.riderId}/documents`, contentType, size) }));
  }

  /** Links an uploaded file to the application. Uploading the same type again replaces the old file. */
  async attachDocument(userId: string, type: RiderDocumentType, fileKey: string) {
    const app = await this.editable(userId);
    if (!fileKey.startsWith(`riders/${app.riderId}/documents/`) || fileKey.includes('..')) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_KEY_INVALID', 'This file was not uploaded for your application');
    }
    const fileHash = await this.storage.hashOf(fileKey);
    if (!fileHash) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_NOT_UPLOADED', 'Upload the file first, then attach it');
    const doc = await this.prisma.riderDocument.upsert({
      where: { riderId_type: { riderId: app.riderId, type } },
      create: { riderId: app.riderId, type, fileKey, fileHash },
      update: { fileKey, fileHash, status: 'PENDING', rejectReason: null, reviewedById: null, reviewedAt: null },
    });
    return this.docView(doc);
  }

  async removeDocument(userId: string, type: RiderDocumentType) {
    const app = await this.editable(userId);
    await this.prisma.riderDocument.deleteMany({ where: { riderId: app.riderId, type } });
    return { removed: type };
  }

  /** Sends the application to ops. Everything must be filled and every required file attached. */
  async submit(userId: string, ip?: string) {
    const app = await this.editable(userId);
    const missing = missingItems(app, app.rider.documents);
    if (missing.steps.length || missing.documents.length) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'APPLICATION_INCOMPLETE', 'Complete every step and upload the required documents first', missing);
    }
    const now = new Date();
    const saved = await this.prisma.riderApplication.updateMany({
      where: { id: app.id, status: { in: [...EDITABLE] } },
      data: { status: 'SUBMITTED', submittedAt: now, consentAt: now },
    });
    if (!saved.count) throw new ApiError(HttpStatus.CONFLICT, 'APPLICATION_LOCKED', 'This application was already sent');
    await this.audit.log({ actorUserId: userId, actorType: 'USER', entity: 'RiderApplication', entityId: app.id, action: 'STATUS_CHANGE', before: { status: app.status }, after: { status: 'SUBMITTED' }, ip });
    return this.view((await this.load(userId))!);
  }

  // ───────── helpers ─────────

  private load(userId: string): Promise<AppWithDocs | null> {
    return this.prisma.riderApplication.findFirst({
      where: { rider: { userId } },
      include: { rider: { select: { id: true, riderCode: true, status: true, suspendReason: true, documents: { orderBy: { type: 'asc' } } } } },
    }) as Promise<AppWithDocs | null>;
  }

  private async editableOrAny(userId: string) {
    const app = await this.load(userId);
    if (!app) throw new ApiError(HttpStatus.NOT_FOUND, 'NO_APPLICATION', 'Start your registration first');
    return app;
  }

  private async editable(userId: string) {
    const app = await this.editableOrAny(userId);
    if (app.rider.status === 'SUSPENDED') throw new ApiError(HttpStatus.FORBIDDEN, 'RIDER_SUSPENDED', 'Your account is restricted. Contact Delivez support.');
    if (!(EDITABLE as readonly string[]).includes(app.status)) {
      throw new ApiError(HttpStatus.CONFLICT, 'APPLICATION_LOCKED', app.status === 'APPROVED' ? 'Your application is already approved' : 'Your application is with the operations team');
    }
    return app;
  }

  private docView(d: RiderDocument) {
    return { id: d.id, type: d.type, status: d.status, rejectReason: d.rejectReason, uploadedAt: d.updatedAt, url: this.storage.signedReadUrl(d.fileKey, 5 * 60) };
  }

  private view(app: AppWithDocs) {
    const missing = missingItems(app, app.rider.documents);
    return {
      id: app.id,
      riderCode: app.rider.riderCode,
      status: app.status,
      editable: (EDITABLE as readonly string[]).includes(app.status) && app.rider.status !== 'SUSPENDED',
      reviewNote: app.reviewNote,
      submittedAt: app.submittedAt,
      reviewedAt: app.reviewedAt,
      steps: Object.fromEntries(STEP_NAMES.map((s) => [s, app[STEPS[s].field] ?? null])),
      documents: app.rider.documents.map((d) => this.docView(d)),
      missing,
      canSubmit: !missing.steps.length && !missing.documents.length,
    };
  }
}
