import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { findReference, FindReferenceError } from '@solana/pay';
import { prisma } from '../../core/services/database-service';
import { CreditsService } from './credits.service';
import { JobProgressGateway } from '../shared/job-progress.gateway';
import { getErrorMessage } from '../../core/utils/error-utils';

const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const HELIUS_RPC_MAINNET = 'https://mainnet.helius-rpc.com/';

@Injectable()
export class PaymentConfirmationService {
  private readonly logger = new Logger(PaymentConfirmationService.name);
  private readonly usdcMint: string;
  private readonly connection: Connection;

  constructor(
    private readonly configService: ConfigService,
    private readonly creditsService: CreditsService,
    private readonly gateway: JobProgressGateway,
  ) {
    this.usdcMint = this.configService.get<string>('USDC_MINT') ?? DEFAULT_USDC_MINT;
    const apiKey = this.configService.get<string>('HELIUS_API_KEY') ?? '';
    const rpcUrl = `${HELIUS_RPC_MAINNET}?api-key=${apiKey}`;
    this.connection = new Connection(rpcUrl, 'confirmed');
  }

  /**
   * Called from the Helius webhook. Finds a pending PaymentIntent whose
   * `reference` pubkey appears in the transaction's account list, then
   * confirms it if a USDC transfer of sufficient amount is present.
   */
  async tryConfirmByAccounts(
    txSignature: string,
    accounts: string[],
    tokenTransfers: Array<{ mint: string; tokenAmount?: number }>,
  ): Promise<void> {
    if (accounts.length === 0) return;

    // Find a pending intent whose reference pubkey is in this transaction
    const intent = await prisma.paymentIntent.findFirst({
      where: {
        status: 'pending',
        reference: { in: accounts },
      },
    });

    if (!intent) return; // Not a payment transaction we care about

    // Helius tokenAmount is raw base units (USDC has 6 decimals).
    // intent.amountUsdc is stored as human float (e.g. 15.0 for $15).
    const usdcTransfer = tokenTransfers.find((t) => {
      if (t.mint !== this.usdcMint || typeof t.tokenAmount !== 'number') return false;
      return (t.tokenAmount as number) >= intent.amountUsdc;
    });

    if (!usdcTransfer) {
      this.logger.warn(
        `payment-webhook: tx ${txSignature} — no USDC transfer >= ${intent.amountUsdc} found for intent ${intent.id}`,
      );
      return;
    }

    await this.confirmIntent(intent.id, intent.userId, intent.credits, txSignature);
  }

  /**
   * Called from the reconciliation job. Uses findReference() to check
   * on-chain for a completed transaction, then confirms if found.
   */
  async tryConfirmByReference(intentId: string): Promise<boolean> {
    const intent = await prisma.paymentIntent.findUnique({ where: { id: intentId } });
    if (!intent || intent.status !== 'pending') return false;

    const referenceKey = new PublicKey(intent.reference);

    try {
      const signatureInfo = await findReference(this.connection, referenceKey, {
        finality: 'confirmed',
      });

      // findReference found a tx — validate amount by fetching the tx
      const tx = await this.connection.getParsedTransaction(signatureInfo.signature, {
        maxSupportedTransactionVersion: 0,
      });

      const tokenAmount = this.extractUsdcAmount(tx, intent.destinationWallet);
      if (tokenAmount === null) {
        this.logger.warn(
          `reconciliation: tx ${signatureInfo.signature} for intent ${intentId} — could not parse USDC amount`,
        );
        return false;
      }

      if (tokenAmount < intent.amountUsdc) {
        this.logger.warn(
          `reconciliation: tx ${signatureInfo.signature} — amount ${tokenAmount} < required ${intent.amountUsdc} for intent ${intentId}`,
        );
        return false;
      }

      await this.confirmIntent(intentId, intent.userId, intent.credits, signatureInfo.signature);
      return true;
    } catch (e) {
      if (e instanceof FindReferenceError) return false; // Not found yet — normal
      this.logger.warn(
        `reconciliation: findReference error for intent ${intentId}: ${getErrorMessage(e)}`,
      );
      return false;
    }
  }

  /**
   * Marks the intent as expired. Called by the reconciliation job for
   * intents that have passed their expiry without a confirmed tx.
   */
  async expireIntent(intentId: string): Promise<void> {
    const result = await prisma.paymentIntent.updateMany({
      where: { id: intentId, status: 'pending' },
      data: { status: 'expired' },
    });
    if (result.count > 0) {
      this.logger.log(`reconciliation: expired intent ${intentId}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async confirmIntent(
    intentId: string,
    userId: string,
    credits: number,
    txSignature: string,
  ): Promise<void> {
    // Idempotent: if already confirmed by a concurrent path, skip
    const updated = await prisma.paymentIntent.updateMany({
      where: { id: intentId, status: 'pending' },
      data: {
        status: 'confirmed',
        confirmedAt: new Date(),
        txSignature,
      },
    });

    if (updated.count === 0) {
      this.logger.debug(`confirmIntent: intent ${intentId} already confirmed — skipping topUp`);
      return;
    }

    const balance = await this.creditsService.topUp(userId, credits, 'purchase', intentId);

    this.logger.log(
      `payment confirmed: intent=${intentId} user=${userId} +${credits} credits → balance=${balance.credits} tx=${txSignature}`,
    );

    // Emit WebSocket event to the user's room
    this.gateway.server?.to(`user-${userId}`).emit('payment:confirmed', {
      intentId,
      credits,
      balance: balance.credits,
      txSignature,
      timestamp: Date.now(),
    });
  }

  private extractUsdcAmount(
    tx: Awaited<ReturnType<Connection['getParsedTransaction']>>,
    destinationWallet: string,
  ): number | null {
    if (!tx) return null;
    const innerInstructions =
      (tx.meta?.innerInstructions ?? []).flatMap((ii) => ii.instructions) as any[];
    const allInstructions = [
      ...(tx.transaction.message.instructions as any[]),
      ...innerInstructions,
    ];

    for (const ix of allInstructions) {
      if (
        ix.parsed?.type === 'transferChecked' &&
        ix.parsed?.info?.mint === this.usdcMint &&
        ix.parsed?.info?.destination
      ) {
        const amount = Number(ix.parsed.info.tokenAmount?.uiAmount ?? 0);
        if (amount > 0) return amount;
      }
      // Also handle plain 'transfer' instructions
      if (
        ix.parsed?.type === 'transfer' &&
        typeof ix.parsed?.info?.amount === 'string'
      ) {
        const amount = Number(ix.parsed.info.amount) / 1e6; // USDC 6 decimals
        if (amount > 0) return amount;
      }
    }
    return null;
  }
}
