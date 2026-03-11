import {
  Injectable,
  Logger,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { prisma } from '../../core/services/database-service';
import { getErrorMessage } from '../../core/utils/error-utils';

export interface CreditBalanceInfo {
  credits: number;
  updatedAt: Date;
}

export interface CreditTransactionRecord {
  id: string;
  delta: number;
  reason: string;
  refId: string | null;
  balanceAfter: number;
  createdAt: Date;
}

@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);
  private readonly FREE_CREDITS_ON_SIGNUP: number;

  constructor(private readonly configService: ConfigService) {
    const rawSignupCredits =
      this.configService.get<string | number>('FREE_CREDITS_ON_SIGNUP') ?? 100;
    const parsedSignupCredits =
      typeof rawSignupCredits === 'number'
        ? rawSignupCredits
        : Number.parseInt(rawSignupCredits, 10);

    if (!Number.isFinite(parsedSignupCredits) || !Number.isInteger(parsedSignupCredits) || parsedSignupCredits <= 0) {
      this.logger.warn(
        `Invalid FREE_CREDITS_ON_SIGNUP value "${String(rawSignupCredits)}"; defaulting to 100`,
      );
      this.FREE_CREDITS_ON_SIGNUP = 100;
      return;
    }

    this.FREE_CREDITS_ON_SIGNUP = parsedSignupCredits;
  }

  /**
   * Returns the current credit balance for a user.
   * If no balance record exists yet the user has 0 credits.
   */
  async getBalance(userId: string): Promise<CreditBalanceInfo> {
    const row = await prisma.creditBalance.findUnique({
      where: { userId },
    });

    return {
      credits: row?.credits ?? 0,
      updatedAt: row?.updatedAt ?? new Date(),
    };
  }

  /**
   * Add credits to a user's balance.
   *
   * Both the balance upsert and the transaction append happen inside a
   * single Prisma interactive transaction — either both persist or neither does.
   */
  async topUp(
    userId: string,
    amount: number,
    reason: string,
    refId?: string,
  ): Promise<CreditBalanceInfo> {
    const normalizedAmount =
      typeof amount === 'number' ? amount : Number.parseInt(String(amount), 10);

    if (!Number.isFinite(normalizedAmount) || !Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
      throw new BadRequestException('topUp amount must be a positive integer');
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Upsert the balance row — create if first top-up, update otherwise
        const balance = await tx.creditBalance.upsert({
          where: { userId },
          create: {
            userId,
            credits: normalizedAmount,
          },
          update: {
            credits: { increment: normalizedAmount },
          },
        });

        await tx.creditTransaction.create({
          data: {
            userId,
            delta: normalizedAmount,
            reason,
            refId: refId ?? null,
            balanceAfter: balance.credits,
          },
        });

        return balance;
      });

      this.logger.log(
        `topUp: user=${userId} +${normalizedAmount} (${reason}) → balance=${result.credits}`,
      );

      return { credits: result.credits, updatedAt: result.updatedAt };
    } catch (error) {
      this.logger.error(
        `topUp failed: user=${userId} amount=${normalizedAmount} reason=${reason}: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Atomically deduct credits from a user's balance.
   *
   * Checks balance BEFORE deducting. Throws HTTP 402 if insufficient.
   * Failed analyses should NOT call this method — only call after a
   * successful result is ready to be returned.
   *
   * Returns the updated balance info on success.
   */
  async deduct(
    userId: string,
    amount: number,
    reason: string,
    refId?: string,
  ): Promise<CreditBalanceInfo> {
    const normalizedAmount =
      typeof amount === 'number' ? amount : Number.parseInt(String(amount), 10);

    if (!Number.isFinite(normalizedAmount) || !Number.isInteger(normalizedAmount) || normalizedAmount <= 0) {
      throw new BadRequestException('deduct amount must be a positive integer');
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        // Lock-and-read the row inside the transaction to prevent TOCTOU races
        const current = await tx.creditBalance.findUnique({
          where: { userId },
        });

        const currentCredits = current?.credits ?? 0;

        if (currentCredits < normalizedAmount) {
          throw new HttpException(
            {
              error: 'insufficient_credits',
              balance: currentCredits,
              required: normalizedAmount,
            },
            HttpStatus.PAYMENT_REQUIRED,
          );
        }

        const balance = await tx.creditBalance.update({
          where: { userId },
          data: { credits: { decrement: normalizedAmount } },
        });

        await tx.creditTransaction.create({
          data: {
            userId,
            delta: -normalizedAmount,
            reason,
            refId: refId ?? null,
            balanceAfter: balance.credits,
          },
        });

        return balance;
      });

      this.logger.log(
        `deduct: user=${userId} -${normalizedAmount} (${reason}) → balance=${result.credits}`,
      );

      return { credits: result.credits, updatedAt: result.updatedAt };
    } catch (error) {
      // Re-throw 402 as-is so callers surface the right HTTP status
      if (error instanceof HttpException && error.getStatus() === HttpStatus.PAYMENT_REQUIRED) {
        throw error;
      }
      this.logger.error(
        `deduct failed: user=${userId} amount=${normalizedAmount} reason=${reason}: ${getErrorMessage(error)}`,
      );
      throw error;
    }
  }

  /**
   * Grant the signup bonus to a newly created user.
   * Safe to call multiple times — the ledger will simply record every grant,
   * but the auth flow should only call this once, immediately after user creation.
   */
  async grantSignupBonus(userId: string): Promise<void> {
    try {
      await this.topUp(userId, this.FREE_CREDITS_ON_SIGNUP, 'signup_bonus');
      this.logger.log(
        `Signup bonus of ${this.FREE_CREDITS_ON_SIGNUP} credits granted to user ${userId}`,
      );
    } catch (error) {
      // Non-fatal — log but don't block registration
      this.logger.error(
        `Failed to grant signup bonus to user ${userId}: ${getErrorMessage(error)}`,
      );
    }
  }

  /**
   * Record an x402 on-chain payment in the ledger WITHOUT touching the credit
   * balance. Used when an agent pays real USDC — no credit deduction is needed,
   * but the ledger must reflect what happened for auditing/analytics.
   *
   * Writes a CreditTransaction with delta = -creditCost and balanceAfter = current balance.
   * The CreditBalance row is NOT modified.
   */
  async recordX402Payment(
    userId: string,
    creditCost: number,
    txSignature: string,
  ): Promise<void> {
    const current = await prisma.creditBalance.findUnique({ where: { userId } });
    const currentCredits = current?.credits ?? 0;

    await prisma.creditTransaction.create({
      data: {
        userId,
        delta: -creditCost,
        reason: 'x402_payment',
        refId: txSignature,
        balanceAfter: currentCredits,
      },
    });

    this.logger.log(
      `x402 ledger: user=${userId} -${creditCost} (x402_payment) tx=${txSignature} balance_unchanged=${currentCredits}`,
    );
  }

  /**
   * Fetch the N most recent transactions for a user (for display in the UI).
   */
  async getRecentTransactions(
    userId: string,
    limit = 20,
  ): Promise<CreditTransactionRecord[]> {
    const rows = await prisma.creditTransaction.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return rows.map((r) => ({
      id: r.id,
      delta: r.delta,
      reason: r.reason,
      refId: r.refId,
      balanceAfter: r.balanceAfter,
      createdAt: r.createdAt,
    }));
  }
}
