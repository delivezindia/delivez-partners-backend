import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BankVerificationStatus } from '@delivez/db';
import { ApiError } from '../../common/api-exception.filter';
import { encryptSecret, nameMatchScore } from '../../common/crypto';
import { AuditService } from '../../events/audit.service';
import { EventBus } from '../../events/event-bus.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { Actor } from './onboarding.service';
import { OnboardingService } from './onboarding.service';
import { IfscService } from './ifsc.service';

export interface BankInput {
  accountHolderName: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  upiId?: string;
}

const AUTO_VERIFY_NAME_MATCH = 0.8;

/**
 * Bank & payout setup (plan §5.3). Penny-drop is faked in dev: accounts ending in 0000 fail,
 * everything else "exists" under the holder name entered. Replace with Razorpay X fund-account validation.
 */
@Injectable()
export class BankService {
  private readonly logger = new Logger(BankService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventBus,
    private readonly audit: AuditService,
    private readonly onboarding: OnboardingService,
    private readonly ifsc: IfscService,
  ) {}

  async save(storeId: string, input: BankInput, actor: Actor) {
    const store = await this.prisma.store.findUniqueOrThrow({
      where: { id: storeId },
      include: { partnerAccount: { include: { bankAccounts: { where: { isPrimary: true } } } }, onboarding: { select: { status: true } } },
    });
    const current = store.partnerAccount.bankAccounts[0];
    const stillOnboarding = store.status === 'DRAFT' || store.onboarding?.status === 'NEEDS_CHANGES';
    if (current?.verificationStatus === 'VERIFIED' && !stillOnboarding) {
      // After go-live a change needs OTP re-verification and a 48 h settlement freeze (plan §5.3) — built with payouts.
      throw new ApiError(HttpStatus.CONFLICT, 'BANK_CHANGE_REQUIRES_OTP', 'To change a verified bank account, contact Delivez support for now');
    }
    if (!input.accountNumber && !input.upiId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'BANK_DETAILS_REQUIRED', 'Enter a bank account or a UPI ID');
    }
    if (input.accountNumber && !input.ifsc) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'IFSC_REQUIRED', 'Enter the IFSC code for this account');
    }
    // A real branch, and its bank name when the partner left it blank.
    const branch = input.accountNumber && input.ifsc ? await this.ifsc.check(input.ifsc) : null;
    const bankName = input.bankName?.trim() || branch?.bank || undefined;

    const owner = await this.prisma.user.findUnique({ where: { id: actor.userId }, select: { fullName: true } });
    let status: BankVerificationStatus = 'UNVERIFIED';
    let score: number | null = null;
    let pennyDropRef: string | null = null;

    if (input.accountNumber) {
      // Fake penny-drop: the bank "returns" the registered name.
      pennyDropRef = `pd_${randomUUID().slice(0, 12)}`;
      if (input.accountNumber.endsWith('0000')) {
        status = 'FAILED';
      } else {
        score = Math.max(
          nameMatchScore(input.accountHolderName, store.partnerAccount.legalName),
          owner?.fullName ? nameMatchScore(input.accountHolderName, owner.fullName) : 0,
        );
        status = score >= AUTO_VERIFY_NAME_MATCH ? 'VERIFIED' : 'PENNY_DROP_PENDING'; // pending → Finance reviews manually
      }
    }

    const saved = await this.prisma.$transaction(async (tx) => {
      await tx.bankAccount.updateMany({ where: { partnerAccountId: store.partnerAccountId, isPrimary: true }, data: { isPrimary: false } });
      const account = await tx.bankAccount.create({
        data: {
          partnerAccountId: store.partnerAccountId,
          accountHolderName: input.accountHolderName,
          accountNumberEnc: input.accountNumber ? encryptSecret(input.accountNumber) : null,
          accountNumberLast4: input.accountNumber?.slice(-4) ?? null,
          ifsc: input.ifsc ?? null,
          bankName: bankName ?? null,
          upiId: input.upiId ?? null,
          verificationStatus: status,
          pennyDropRef,
          nameMatchScore: score,
          isPrimary: true,
        },
      });
      await this.audit.log(
        {
          actorUserId: actor.userId,
          actorType: 'USER',
          entity: 'BankAccount',
          entityId: account.id,
          action: 'CREATE',
          after: { last4: account.accountNumberLast4, ifsc: account.ifsc, upiId: account.upiId, status },
          ip: actor.ip,
        },
        tx,
      );
      await this.events.publish(tx, {
        type: 'bank.verification_updated',
        data: { storeId, bankAccountId: account.id, status, nameMatchScore: score },
        actor: { type: 'PARTNER', userId: actor.userId },
        correlationId: actor.correlationId,
      });
      return account;
    });

    await this.onboarding.refreshReadiness(storeId);
    if (status === 'FAILED') {
      throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'PENNY_DROP_FAILED', 'We could not verify this account. Check the account number and IFSC.', {
        bankAccountId: saved.id,
      });
    }
    return {
      id: saved.id,
      accountHolderName: saved.accountHolderName,
      accountNumberLast4: saved.accountNumberLast4,
      ifsc: saved.ifsc,
      bankName: saved.bankName,
      upiId: saved.upiId,
      verificationStatus: saved.verificationStatus,
      nameMatchScore: saved.nameMatchScore,
    };
  }
}
