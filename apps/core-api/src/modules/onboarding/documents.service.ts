import { HttpStatus, Injectable } from '@nestjs/common';
import type { DocumentType, OnboardingChannel, Prisma } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../files/storage.service';
import { optionalDocuments, requiredDocuments } from './flows';
import type { Actor } from './onboarding.service';
import { OnboardingService } from './onboarding.service';
import { docLabel } from './readiness';
import { readingRecord, type DocReadingInput } from './doc-reading';

export interface RegisterDocumentInput {
  type: DocumentType;
  fileKey: string;
  documentNumber?: string;
  issuedAt?: Date;
  expiresAt?: Date;
  reading?: DocReadingInput;
}

// Partner documents (plan §5.2): upload never blocks the flow; compliance verifies in Admin (Step 7).
@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly onboarding: OnboardingService,
  ) {}

  presign(storeId: string, contentType: string, size: number) {
    return this.storage.presignUpload(`stores/${storeId}/documents`, contentType, size);
  }

  async register(storeId: string, input: RegisterDocumentInput, actor: Actor & { channel: OnboardingChannel }) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { storeType: true, partnerAccountId: true, status: true, partnerAccount: { select: { gstin: true } } } });
    const allowed = new Set<DocumentType>([...requiredDocuments(store.storeType), ...optionalDocuments(store.storeType), 'OTHER']);
    if (!allowed.has(input.type)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'DOCUMENT_TYPE_NOT_ALLOWED', `${docLabel(input.type)} is not needed for this store type`);
    }
    if (!input.fileKey.startsWith(`stores/${storeId}/documents/`)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_KEY_INVALID', 'This file was not uploaded for this store');
    }
    if (input.expiresAt && input.expiresAt < new Date()) {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'DOCUMENT_EXPIRED', 'This document has already expired. Upload a valid one.');
    }
    const fileHash = await this.storage.hashOf(input.fileKey);
    if (!fileHash) throw new ApiError(HttpStatus.BAD_REQUEST, 'FILE_NOT_UPLOADED', 'Upload the file before saving the document');

    const doc = await this.prisma.$transaction(async (tx) => {
      // Earlier uploads of the same type stay for audit; the newest one is the one reviewed.
      const created = await tx.partnerDocument.create({
        data: {
          storeId,
          partnerAccountId: store.partnerAccountId,
          type: input.type,
          documentNumber: input.documentNumber?.trim().toUpperCase() || null,
          issuedAt: input.issuedAt,
          expiresAt: input.expiresAt,
          fileUrl: input.fileKey,
          fileHash,
          status: 'PENDING',
          uploadedVia: actor.channel,
          ocrData: readingRecord(input.type, input.reading, { documentNumber: input.documentNumber, expiresAt: input.expiresAt }, store.partnerAccount.gstin) as Prisma.InputJsonValue,
        },
      });
      await this.audit.log({ actorUserId: actor.userId, actorType: 'USER', entity: 'PartnerDocument', entityId: created.id, action: 'CREATE', after: { type: created.type }, ip: actor.ip }, tx);
      await this.events.publish(tx, {
        type: 'document.uploaded',
        data: { storeId, documentId: created.id, type: created.type, storeStatus: store.status },
        actor: { type: 'PARTNER', userId: actor.userId },
        correlationId: actor.correlationId,
      });
      return created;
    });

    await this.onboarding.refreshReadiness(storeId);
    return this.toView(doc);
  }

  /** Required/optional document types for the store plus the latest upload of each (works with or without onboarding). */
  async list(storeId: string) {
    const store = await this.prisma.store.findUniqueOrThrow({ where: { id: storeId }, select: { storeType: true } });
    const docs = await this.prisma.partnerDocument.findMany({ where: { storeId }, orderBy: { createdAt: 'desc' } });
    const latest = docs.filter((d, i) => docs.findIndex((x) => x.type === d.type) === i);
    return {
      required: requiredDocuments(store.storeType).map((type) => ({ type, label: docLabel(type) })),
      optional: optionalDocuments(store.storeType).map((type) => ({ type, label: docLabel(type) })),
      uploaded: latest.map((d) => this.toView(d)),
      history: docs.filter((d) => !latest.includes(d)).map((d) => this.toView(d)),
    };
  }

  private toView(d: { id: string; type: DocumentType; status: string; documentNumber: string | null; expiresAt: Date | null; rejectionReason: string | null; createdAt: Date; fileUrl: string }) {
    return {
      id: d.id,
      type: d.type,
      label: docLabel(d.type),
      status: d.status,
      documentNumber: d.documentNumber,
      expiresAt: d.expiresAt,
      rejectionReason: d.rejectionReason,
      createdAt: d.createdAt,
      viewUrl: this.storage.signedReadUrl(d.fileUrl),
    };
  }
}
