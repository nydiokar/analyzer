import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EvmApiClient } from './evm-api-client';
import { mapEvmTransactionsToSwapInputs, MappingStats } from './evm-transaction-mapper';
import { DatabaseService } from 'api/services/database.service';
import { EvmChain } from '@/types/evm-api';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('EvmSyncService');

export interface EvmSyncOptions {
  maxTransactions?: number;
  fromBlock?: number;
  toBlock?: number | 'latest';
  skipSave?: boolean; // for testing/preview
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

  /**
   * Sync all EVM wallet transactions for a given wallet and chain.
   * Fetches transfers, resolves full tx data, maps to SwapAnalysisInput,
   * and saves to the database.
   */
  async syncWalletData(
    walletAddress: string,
    chain: EvmChain,
    options: EvmSyncOptions = {},
  ): Promise<EvmSyncResult> {
    const startMs = Date.now();
    const maxTransactions = options.maxTransactions ?? 500;

    logger.info(`Starting EVM sync for ${walletAddress} on ${chain}`);

    // Step 1: Fetch transfer list (efficient — no RPC per tx)
    const transfers = await this.evmApiClient.getTransfersForAddress(walletAddress, chain, {
      fromBlock: options.fromBlock,
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

    // Step 2: Get unique tx hashes and fetch full tx data with logs
    const txHashes = this.evmApiClient.extractTxHashes(transfers);
    logger.info(`Fetching ${txHashes.length} unique transactions with logs`);

    const transactions = await this.evmApiClient.getTransactionsWithLogs(txHashes, chain);
    logger.info(`Fetched ${transactions.length} transactions successfully`);

    // Step 3: Map transactions to SwapAnalysisInput records
    const { records, stats } = mapEvmTransactionsToSwapInputs(transactions, walletAddress, chain);
    logger.info(`Mapped ${records.length} swap/transfer records`);

    if (options.skipSave || records.length === 0) {
      return { walletAddress, chain, stats, savedCount: 0, durationMs: Date.now() - startMs };
    }

    // Step 4: Save to database using DatabaseService's existing method
    let savedCount = 0;
    try {
      // Convert CreateManyInput to CreateInput format (add walletAddress as relation)
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

      // Update wallet's last fetch timestamp
      await this.databaseService.updateWallet(walletAddress, {
        lastSuccessfulFetchTimestamp: new Date(),
      });
    } catch (err) {
      logger.error(`Failed to save records for ${walletAddress}: ${String(err)}`);
      throw err;
    }

    return {
      walletAddress,
      chain,
      stats,
      savedCount,
      durationMs: Date.now() - startMs,
    };
  }
}
