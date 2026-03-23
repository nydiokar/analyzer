import { Injectable, Logger, HttpException, HttpStatus, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Connection,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { CreditsService } from './credits.service';
import { prisma } from '../../core/services/database-service';
import { User } from '@prisma/client';
import { randomUUID } from 'crypto';

// Minimal subset of x402 types. The x402 package uses package exports
// incompatible with moduleResolution:node, so we declare locally.
interface ExactSvmPayload {
  transaction: string; // base64-encoded signed transaction bytes
}
interface PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: ExactSvmPayload | Record<string, unknown>;
}

const DEFAULT_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const HELIUS_RPC_MAINNET = 'https://mainnet.helius-rpc.com/';
const USDC_PER_CREDIT = 0.015;
const USDC_DECIMALS = 6;
const TX_DEDUP_TTL_SECONDS = 86400; // 24h

// Sentinel suffix that identifies auto-provisioned agent accounts
const AGENT_EMAIL_SUFFIX = '@x402.agent';

@Injectable()
export class X402VerificationService {
  private readonly logger = new Logger(X402VerificationService.name);
  private readonly connection: Connection;
  private readonly usdcMint: string;
  private readonly treasury: string;
  private readonly treasuryAta: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly creditsService: CreditsService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    this.usdcMint = this.configService.get<string>('USDC_MINT') ?? DEFAULT_USDC_MINT;
    this.treasury = this.configService.get<string>('TREASURY_WALLET_ADDRESS') ?? '';
    const apiKey = this.configService.get<string>('HELIUS_API_KEY') ?? '';
    this.connection = new Connection(`${HELIUS_RPC_MAINNET}?api-key=${apiKey}`, 'confirmed');
    this.treasuryAta = getAssociatedTokenAddressSync(
      new PublicKey(this.usdcMint),
      new PublicKey(this.treasury),
    ).toBase58();
  }

  /**
   * Resolves (or creates) the agent User record for a given Solana wallet pubkey.
   * Called by CompositeAuthGuard before any other auth check when X-Payment is present.
   *
   * Uses email = `<pubkey>@x402.agent` as the unique identity key.
   * The returned user is a real DB row — can be blocked via isActive=false if needed.
   */
  async findOrCreateAgentUser(walletPubkey: string): Promise<User> {
    const email = `${walletPubkey}${AGENT_EMAIL_SUFFIX}`;

    const user = await prisma.user.upsert({
      where: { email },
      update: { lastSeenAt: new Date() },
      create: {
        email,
        apiKey: randomUUID(), // required by schema, never used for x402 agents
        displayName: `agent:${walletPubkey.slice(0, 8)}`,
        emailVerified: true,  // no email flow for agents
        isActive: true,
        isDemo: false,
        isAdmin: false,
      },
    });

    if (!user.isActive) {
      throw new HttpException(
        `x402: agent wallet ${walletPubkey} has been blocked`,
        HttpStatus.FORBIDDEN,
      );
    }

    return user;
  }

  /**
   * Extracts the payer wallet pubkey from the X-Payment header without
   * submitting the transaction. Called by CompositeAuthGuard to identify
   * the agent early in the guard chain.
   *
   * Throws HTTP 402 if the header cannot be parsed.
   */
  extractPayerFromHeader(xPaymentHeader: string): string {
    let paymentPayload: PaymentPayload;
    try {
      const json = Buffer.from(xPaymentHeader, 'base64').toString('utf-8');
      paymentPayload = JSON.parse(json) as PaymentPayload;
    } catch {
      throw new HttpException(
        'x402: invalid payment header (not base64 JSON)',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const svmPayload = paymentPayload.payload as ExactSvmPayload;
    if (!svmPayload?.transaction) {
      throw new HttpException(
        'x402: missing transaction in payment payload',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    let txBytes: Buffer;
    try {
      txBytes = Buffer.from(svmPayload.transaction, 'base64');
    } catch {
      throw new HttpException('x402: invalid base64 transaction', HttpStatus.PAYMENT_REQUIRED);
    }

    return this.extractPayer(txBytes);
  }

  /**
   * Validates an X-PAYMENT header locally (no network calls):
   *
   * 1. Parses the base64 JSON payload
   * 2. Decodes tx bytes and validates USDC transferChecked instruction (mint, recipient, amount)
   *
   * Throws HTTP 402 on any failure.
   * Returns the raw transaction bytes for use by confirmAndRecord().
   */
  async validateOnly(xPaymentHeader: string, creditCost: number): Promise<{ txBytes: Buffer }> {
    // --- 1. Parse header ---
    let paymentPayload: PaymentPayload;
    try {
      const json = Buffer.from(xPaymentHeader, 'base64').toString('utf-8');
      paymentPayload = JSON.parse(json) as PaymentPayload;
    } catch {
      throw new HttpException('x402: invalid payment header (not base64 JSON)', HttpStatus.PAYMENT_REQUIRED);
    }

    const svmPayload = paymentPayload.payload as ExactSvmPayload;
    if (!svmPayload?.transaction) {
      throw new HttpException('x402: missing transaction in payment payload', HttpStatus.PAYMENT_REQUIRED);
    }

    let txBytes: Buffer;
    try {
      txBytes = Buffer.from(svmPayload.transaction, 'base64');
    } catch {
      throw new HttpException('x402: invalid base64 transaction', HttpStatus.PAYMENT_REQUIRED);
    }

    // --- 2. Validate locally before broadcasting ---
    const requiredBaseUnits = Math.ceil(creditCost * USDC_PER_CREDIT * Math.pow(10, USDC_DECIMALS));

    try {
      const { transferAmount } = this.extractUsdcTransfer(txBytes);

      if (transferAmount < requiredBaseUnits) {
        throw new HttpException(
          `x402: USDC amount ${transferAmount} < required ${requiredBaseUnits} (${creditCost} credits = $${(requiredBaseUnits / 1e6).toFixed(4)})`,
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
    } catch (e) {
      if (e instanceof HttpException) throw e;
      throw new HttpException(
        `x402: could not parse transaction — ${(e as Error).message}`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return { txBytes };
  }

  /**
   * Step 1 of two-phase x402 confirmation: broadcasts the transaction and returns
   * the signature immediately (~100-200ms). Does NOT wait for on-chain confirmation.
   *
   * Call this in the guard so the signature is available to set the response header
   * synchronously before the handler runs.
   *
   * Throws HTTP 402 on RPC submission failure.
   */
  async broadcastAndGetSig(txBytes: Buffer): Promise<string> {
    try {
      const txSig = await this.connection.sendRawTransaction(txBytes, {
        skipPreflight: false,
        preflightCommitment: 'confirmed',
      });
      return txSig;
    } catch (e) {
      throw new HttpException(
        `x402: transaction broadcast failed — ${(e as Error).message}`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /**
   * Step 2 of two-phase x402 confirmation: waits for on-chain confirmation, claims
   * the signature in Redis (replay protection), and records in the credit ledger.
   *
   * Fire-and-forget from the interceptor — response is already sent by this point.
   * Failures are logged but not thrown (cannot reverse the response).
   */
  async confirmAndRecord(txSig: string, creditCost: number, userId: string, requestUrl: string): Promise<void> {
    // --- Confirm on-chain ---
    try {
      const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
      await this.connection.confirmTransaction(
        { signature: txSig, ...latestBlockhash },
        'confirmed',
      );
      this.logger.log(`x402: tx confirmed — sig=${txSig} credits=${creditCost} url=${requestUrl}`);
    } catch (e) {
      this.logger.error(`x402: tx confirmation failed — sig=${txSig} err=${(e as Error).message}`);
      // Non-fatal from the response perspective — already broadcast, log for reconciliation.
      return;
    }

    // --- Atomic replay protection: SET NX (only one winner per sig) ---
    const redisKey = `x402:tx:${txSig}`;
    const claimed = await this.redis
      .set(redisKey, userId, 'EX', TX_DEDUP_TTL_SECONDS, 'NX')
      .catch(() => null);

    if (claimed === null) {
      this.logger.warn(`x402: duplicate confirmation attempt for sig=${txSig} (already claimed)`);
      return;
    }

    // --- Record in credit ledger (balance unchanged — agent paid on-chain) ---
    await this.creditsService.recordX402Payment(userId, creditCost, txSig).catch((err) => {
      this.logger.warn(`x402: ledger record failed for tx=${txSig}: ${(err as Error).message}`);
    });
  }

  /**
   * Broadcasts, confirms, and records an already-validated x402 payment in one call.
   * Convenience wrapper used by the legacy verify() path.
   *
   * Throws HTTP 402 on RPC failure or replay attempt.
   * Returns the confirmed on-chain transaction signature (base58).
   */
  async broadcastConfirmAndRecord(txBytes: Buffer, creditCost: number, userId: string, requestUrl: string): Promise<string> {
    const txSig = await this.broadcastAndGetSig(txBytes);

    try {
      const latestBlockhash = await this.connection.getLatestBlockhash('confirmed');
      await this.connection.confirmTransaction(
        { signature: txSig, ...latestBlockhash },
        'confirmed',
      );
      this.logger.log(`x402: tx confirmed — sig=${txSig} credits=${creditCost} url=${requestUrl}`);
    } catch (e) {
      throw new HttpException(
        `x402: transaction confirmation failed — ${(e as Error).message}`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const redisKey = `x402:tx:${txSig}`;
    const claimed = await this.redis
      .set(redisKey, userId, 'EX', TX_DEDUP_TTL_SECONDS, 'NX')
      .catch(() => null);

    if (claimed === null) {
      throw new HttpException('x402: transaction already used (replay attack)', HttpStatus.PAYMENT_REQUIRED);
    }

    await this.creditsService.recordX402Payment(userId, creditCost, txSig).catch((err) => {
      this.logger.warn(`x402: ledger record failed for tx=${txSig}: ${(err as Error).message}`);
    });

    return txSig;
  }

  /**
   * Verifies an X-PAYMENT header end-to-end:
   *
   * 1. Parses the base64 JSON payload
   * 2. Validates USDC transferChecked instruction (mint, recipient, amount)
   * 3. Submits + confirms on-chain
   * 4. Atomically claims tx signature in Redis (replay protection)
   * 5. Records the payment in the credit ledger
   *
   * Throws HTTP 402 with a reason on any failure.
   * Returns the confirmed on-chain transaction signature (base58).
   */
  async verify(xPaymentHeader: string, creditCost: number, userId: string, requestUrl: string): Promise<string> {
    const { txBytes } = await this.validateOnly(xPaymentHeader, creditCost);
    return this.broadcastConfirmAndRecord(txBytes, creditCost, userId, requestUrl);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Extracts the fee payer / authority pubkey from transaction bytes.
   * For a standard SPL transferChecked: accounts[3] = authority (signer).
   * Falls back to the transaction fee payer if not determinable.
   */
  private extractPayer(txBytes: Buffer): string {
    try {
      const vTx = VersionedTransaction.deserialize(txBytes);
      // Fee payer is always the first static account key
      return vTx.message.staticAccountKeys[0].toBase58();
    } catch {
      const legacyTx = Transaction.from(txBytes);
      if (legacyTx.feePayer) return legacyTx.feePayer.toBase58();
      if (legacyTx.signatures[0]) return legacyTx.signatures[0].publicKey.toBase58();
      throw new HttpException('x402: could not determine payer from transaction', HttpStatus.PAYMENT_REQUIRED);
    }
  }

  /**
   * Decodes a Solana transaction and finds the USDC transferChecked instruction.
   * Returns the raw base unit amount.
   *
   * Throws HttpException 402 if transfer recipient is not the treasury.
   * Throws plain Error if no valid instruction is found.
   */
  private extractUsdcTransfer(txBytes: Buffer): { transferAmount: number } {
    let instructions: { programId: PublicKey; data: Buffer; keys: { pubkey: PublicKey }[] }[];

    try {
      const vTx = VersionedTransaction.deserialize(txBytes);
      const staticKeys = vTx.message.staticAccountKeys;
      instructions = vTx.message.compiledInstructions.map((ix) => ({
        programId: staticKeys[ix.programIdIndex],
        data: Buffer.from(ix.data),
        keys: ix.accountKeyIndexes.map((i) => ({ pubkey: staticKeys[i] })),
      }));
    } catch {
      const legacyTx = Transaction.from(txBytes);
      instructions = legacyTx.instructions.map((ix) => ({
        programId: ix.programId,
        data: ix.data as Buffer,
        keys: ix.keys.map((k) => ({ pubkey: k.pubkey })),
      }));
    }

    const SPL_TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
    const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

    for (const ix of instructions) {
      const prog = ix.programId.toBase58();
      if (prog !== SPL_TOKEN_PROGRAM && prog !== TOKEN_2022_PROGRAM) continue;

      // transferChecked discriminator: 12 (0x0c)
      // Layout: [discriminator(1)] [amount(8 LE u64)] [decimals(1)]
      // Accounts: [source_ata(0), mint(1), destination_ata(2), authority(3), ...]
      if (ix.data.length >= 9 && ix.data[0] === 12) {
        const amount = Number(ix.data.readBigUInt64LE(1));
        const mint = ix.keys[1]?.pubkey.toBase58();
        const destination = ix.keys[2]?.pubkey.toBase58();

        if (mint !== this.usdcMint) continue;

        if (destination !== this.treasuryAta) {
          throw new HttpException(
            `x402: transfer destination ${destination} does not match treasury ATA ${this.treasuryAta}`,
            HttpStatus.PAYMENT_REQUIRED,
          );
        }

        return { transferAmount: amount };
      }
    }

    throw new HttpException(
      'x402: no USDC transferChecked instruction found in transaction',
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
