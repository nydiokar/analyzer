import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EvmApiClient } from './evm-api-client';
import { mapEvmTransactionsToSwapInputs, MappingStats, TOKEN_DECIMALS_CACHE } from './evm-transaction-mapper';
import { classifyEvmTransaction } from './evm-transaction-classifier';
import { DatabaseService } from 'api/services/database.service';
import { EvmChain, EvmTransaction } from '@/types/evm-api';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('EvmSyncService');

export interface EvmSyncOptions {
  maxTransactions?: number;
  enrichLimit?: number;   // max receipts to fetch (default 50)
  fromBlock?: number;
  toBlock?: number | 'latest';
  skipSave?: boolean;
}

export interface EvmSyncResult {
  walletAddress: string;
  chain: EvmChain;
  stats: MappingStats;
  savedCount: number;
  durationMs: number;
}

@Injectable()
export class EvmSyncService {
  constructor(
    private readonly evmApiClient: EvmApiClient,
    private readonly databaseService: DatabaseService,
  ) {}

  async syncWalletData(
    walletAddress: string,
    chain: EvmChain,
    options: EvmSyncOptions = {},
  ): Promise<EvmSyncResult> {
    const startMs = Date.now();
    const maxTransactions = options.maxTransactions ?? 500;
    const enrichLimit = options.enrichLimit ?? 50;
    // Normalise to lowercase — EVM addresses are hex (case-insensitive).
    // This ensures wallet row and SwapAnalysisInput.walletAddress always match.
    walletAddress = walletAddress.toLowerCase();

    logger.info(`Starting EVM sync for ${walletAddress} on ${chain}`);

    // Incremental sync: use lastSyncedBlock from DB unless caller overrides fromBlock.
    // Only apply if the wallet's stored chain matches the current chain — block numbers
    // are chain-specific, so a block from Arbitrum must not be used as a fromBlock on Base.
    let fromBlock = options.fromBlock;
    if (fromBlock === undefined && !options.skipSave) {
      try {
        const existing = await this.databaseService.getWallet(walletAddress);
        if (existing?.lastSyncedBlock && existing.chain === chain) {
          fromBlock = existing.lastSyncedBlock + 1;
          logger.info(`Incremental sync: starting from block ${fromBlock} (lastSyncedBlock=${existing.lastSyncedBlock})`);
        }
      } catch { /* wallet not in DB yet — full sync */ }
    }

    // Step 1: Fetch all ERC-20 transfers (2 RPC calls regardless of wallet size)
    const transfers = await this.evmApiClient.getTransfersForAddress(walletAddress, chain, {
      fromBlock,
      toBlock: options.toBlock,
      maxCount: maxTransactions,
    });

    logger.info(`Found ${transfers.length} transfers for ${walletAddress}`);

    if (transfers.length === 0) {
      return {
        walletAddress,
        chain,
        stats: {
          transactionsReceived: 0,
          transactionsSkipped: 0,
          transactionsProcessed: 0,
          inputsGenerated: 0,
          swapsDetected: 0,
          transfersDetected: 0,
          unknownSkipped: 0,
        },
        savedCount: 0,
        durationMs: Date.now() - startMs,
      };
    }

    // Step 2: Resolve token decimals — Alchemy already returns decimals in transfer
    // metadata so this is free for most tokens; eth_call fallback for the remainder.
    const tokenDecimalsMap = await this.evmApiClient.resolveTokenDecimals(
      transfers, chain, TOKEN_DECIMALS_CACHE,
    );
    logger.info(`Resolved decimals for ${tokenDecimalsMap.size} tokens`);

    // Step 3: Build EvmTransaction objects from transfer metadata (zero extra RPC calls)
    const transactions = this.evmApiClient.buildTransactionsFromTransfers(transfers, walletAddress, chain);
    logger.info(`Built ${transactions.length} transactions from transfers`);

    // Track the highest block number seen so we can resume from here next time
    const highestBlock = transfers.reduce(
      (max, t) => Math.max(max, parseInt(t.blockNum, 16)),
      0,
    );

    // Step 4: Smart enrichment — prioritize outgoing swaps so value extraction
    // has full logs for the txs that actually matter for PnL (not just incoming).
    const toEnrich = selectTransactionsForEnrichment(transactions, walletAddress, chain, enrichLimit);
    logger.info(`Enriching ${toEnrich.length} transactions with receipts (limit: ${enrichLimit})`);

    const enriched = await this.evmApiClient.enrichWithReceipts(toEnrich, chain);

    // Merge enriched txs back into the full set
    const enrichedByHash = new Map(enriched.map(t => [t.hash, t]));
    const merged = transactions.map(t => enrichedByHash.get(t.hash) ?? t);

    // Step 5: Map to SwapAnalysisInput records
    const { records, stats } = mapEvmTransactionsToSwapInputs(merged, walletAddress, chain, tokenDecimalsMap);
    logger.info(`Mapped ${records.length} swap/transfer records`);

    if (options.skipSave || records.length === 0) {
      return { walletAddress, chain, stats, savedCount: 0, durationMs: Date.now() - startMs };
    }

    // Step 6: Save to database
    let savedCount = 0;
    try {
      // Upsert wallet first so the row exists with the correct chain set.
      await this.databaseService.updateWallet(walletAddress, {
        chain,
        lastSuccessfulFetchTimestamp: new Date(),
        ...(highestBlock > 0 ? { lastSyncedBlock: highestBlock } : {}),
      });

      const createInputs: Prisma.SwapAnalysisInputCreateInput[] = records.map(r => ({
        walletAddress: r.walletAddress as string,
        signature: r.signature as string,
        timestamp: r.timestamp as number,
        mint: r.mint as string,
        amount: r.amount as number,
        direction: r.direction as string,
        associatedSolValue: r.associatedSolValue as number,
        interactionType: r.interactionType as string,
        feeAmount: r.feeAmount ?? undefined,
        feePercentage: r.feePercentage ?? undefined,
      }));

      const result = await this.databaseService.saveSwapAnalysisInputs(createInputs);
      savedCount = result.count;
      logger.info(`Saved ${savedCount} new records for ${walletAddress} on ${chain}`);
    } catch (err) {
      logger.error(`Failed to save records for ${walletAddress}: ${String(err)}`);
      throw err;
    }

    return { walletAddress, chain, stats, savedCount, durationMs: Date.now() - startMs };
  }
}

/**
 * Select which transactions to enrich with receipts.
 *
 * Priority order (most important for value extraction first):
 * 1. Outgoing swaps (wallet sent tokens — these determine cost basis / ETH spent)
 * 2. Incoming swaps (wallet received tokens — ETH received)
 * 3. Everything else up to the limit
 *
 * This fixes the "ETH spent = 0" issue where naively enriching the first N txs
 * would only hit incoming transfers and miss the outgoing swap receipts.
 */
export function selectTransactionsForEnrichment(
  transactions: EvmTransaction[],
  walletAddress: string,
  chain: string,
  limit: number,
): EvmTransaction[] {
  if (transactions.length <= limit) return transactions;

  const walletLower = walletAddress.toLowerCase();

  // Pre-classify using synthesised logs (no RPC needed)
  type Scored = { tx: EvmTransaction; score: number };
  const scored: Scored[] = transactions.map(tx => {
    const { classification } = classifyEvmTransaction(tx.to, tx.logs, walletLower, chain);
    if (classification !== 'SWAP') return { tx, score: 0 };

    // Outgoing swaps have higher score than incoming
    const hasOut = tx.logs.some(l => {
      const from = l.topics[1]?.slice(-40);
      return from && `0x${from}` === walletLower;
    });
    return { tx, score: hasOut ? 2 : 1 };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(s => s.tx);
}
