import { Injectable } from '@nestjs/common';
import type { Prisma } from '@delivez/db';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEntry {
  actorUserId?: string;
  actorType: 'USER' | 'ADMIN' | 'SYSTEM' | 'AI';
  entity: string;
  entityId: string;
  action: 'CREATE' | 'UPDATE' | 'STATUS_CHANGE' | 'DELETE' | 'LOGIN' | 'LOGOUT';
  before?: unknown;
  after?: unknown;
  ip?: string;
}

// Append-only audit trail (plan §15). Pass `tx` to write inside the same transaction as the change.
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry, tx?: Prisma.TransactionClient) {
    const client = tx ?? this.prisma;
    await client.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        actorType: entry.actorType,
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        before: (entry.before ?? undefined) as Prisma.InputJsonValue | undefined,
        after: (entry.after ?? undefined) as Prisma.InputJsonValue | undefined,
        ip: entry.ip,
      },
    });
  }
}
