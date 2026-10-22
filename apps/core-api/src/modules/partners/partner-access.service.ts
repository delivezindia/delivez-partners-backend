import { Injectable } from '@nestjs/common';
import type { PartnerRole } from '@delivez/db';
import { PrismaService } from '../../prisma/prisma.service';

export interface StoreAccess {
  storeId: string;
  partnerAccountId: string;
  role: PartnerRole;
}

@Injectable()
export class PartnerAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's membership for a store, or null. `storeIds = []` on a membership means every store of the account. */
  async forStore(userId: string, storeId: string): Promise<StoreAccess | null> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: { partnerAccountId: true } });
    if (!store) return null;
    const member = await this.prisma.partnerMember.findUnique({
      where: { userId_partnerAccountId: { userId, partnerAccountId: store.partnerAccountId } },
    });
    if (!member?.isActive) return null;
    if (member.storeIds.length > 0 && !member.storeIds.includes(storeId)) return null;
    return { storeId, partnerAccountId: store.partnerAccountId, role: member.role };
  }
}
