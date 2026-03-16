import { Injectable, Logger } from '@nestjs/common';
import { HeliusApiClient } from '../../core/services/helius-api-client';
import { mapHeliusTransactionsToIntermediateRecords } from '../../core/services/helius-transaction-mapper';
import { HeliusTransaction } from '../../types/helius-api';
import { SigBuyerResult, SigBuyersResponseDto } from '../shared/dto/sig-buyers.dto';
import { isKnownWallet } from '../../config/known-wallets';
import { SystemWalletDetectionService } from './system-wallet-detection.service';

@Injectable()
export class SigBuyersService {
  private readonly logger = new Logger(SigBuyersService.name);

  constructor(
    private readonly heliusClient: HeliusApiClient,
    private readonly systemWalletDetection: SystemWalletDetectionService,
  ) {}

  async findSignificantBuyers(
    mint: string,
    startTime: number,
    endTime: number,
    minSolSpent: number = 0.5,
    maxTransactions: number = 10000,
  ): Promise<SigBuyersResponseDto> {
    const t0 = Date.now();

    // Phase 1: collect signatures via RPC with blockTime filters
    const allSignatures = await this.collectSignatures(mint, startTime, endTime, maxTransactions);

    if (allSignatures.length === 0) {
      return {
        mint,
        startTime,
        endTime,
        minSolSpent,
        totalTransactionsFetched: 0,
        totalWalletsFound: 0,
        qualifyingWallets: 0,
        buyers: [],
        durationMs: Date.now() - t0,
      };
    }

    // Phase 2: enrich signatures into full parsed transactions
    const transactions = await this.enrichSignatures(allSignatures);

    // Phase 3: group by wallet (registry-known addresses already stripped inline)
    const transactionsByWallet = this.groupByWallet(transactions, mint);

    // Phase 4: filter remaining wallets through SystemWalletDetectionService
    // (catches vaults/pools that aren't in the static registry via DB + token-count RPC)
    const { valid: validWallets } = await this.systemWalletDetection.filterSystemWallets(
      Array.from(transactionsByWallet.keys()),
      { skipDynamic: true }, // skip live RPC token-count — too slow for hundreds of wallets
    );
    const validSet = new Set(validWallets);

    // Phase 5: run mapper + aggregate SOL values per wallet
    const walletAnalysis = this.analyzeWallets(transactionsByWallet, mint, validSet);

    // Phase 5: filter + sort
    let buyers = Array.from(walletAnalysis.entries())
      .filter(([, a]) => a.solSpent >= minSolSpent)
      .sort(([, a], [, b]) => b.solSpent - a.solSpent)
      .map(([walletAddress, a]): SigBuyerResult => ({
        walletAddress,
        tokensBought: a.tokensBought,
        solSpent: a.solSpent,
        solReceived: a.solReceived,
        netPnl: a.solReceived - a.solSpent,
        transactionCount: a.transactionCount,
        firstTransactionAt: new Date(a.firstTransaction * 1000).toISOString(),
        lastTransactionAt: new Date(a.lastTransaction * 1000).toISOString(),
      }));

    return {
      mint,
      startTime,
      endTime,
      minSolSpent,
      totalTransactionsFetched: transactions.length,
      totalWalletsFound: walletAnalysis.size,
      qualifyingWallets: buyers.length,
      buyers,
      durationMs: Date.now() - t0,
    };
  }

  private async collectSignatures(
    mint: string,
    startTime: number,
    endTime: number,
    maxTransactions: number,
  ): Promise<string[]> {
    const allSignatures: string[] = [];
    let paginationToken: string | undefined;
    let pagesFetched = 0;
    const MAX_PAGES = 200;

    while (allSignatures.length < maxTransactions && pagesFetched < MAX_PAGES) {
      const result = await (this.heliusClient as any)['getTransactionsForAddressSignatures'](mint, {
        limit: 1000,
        sortOrder: 'desc',
        paginationToken,
        filters: {
          blockTime: { gte: startTime, lte: endTime },
        },
      });

      pagesFetched++;
      const sigs = (result.signatures || []).map((s: any) => s.signature);

      if (sigs.length === 0) break;

      allSignatures.push(...sigs);
      paginationToken = result.paginationToken;

      if (!paginationToken) break;
    }

    return allSignatures;
  }

  private async enrichSignatures(signatures: string[]): Promise<HeliusTransaction[]> {
    const BATCH = 100;
    const all: HeliusTransaction[] = [];

    for (let i = 0; i < signatures.length; i += BATCH) {
      const batch = signatures.slice(i, i + BATCH);
      try {
        const txs: HeliusTransaction[] = await (this.heliusClient as any)['getTransactionsBySignatures'](batch);
        all.push(...txs.filter(Boolean));
      } catch (err) {
        this.logger.warn(`Enrichment batch ${Math.floor(i / BATCH) + 1} failed: ${err}`);
      }
    }

    return all;
  }

  private groupByWallet(
    transactions: HeliusTransaction[],
    mint: string,
  ): Map<string, HeliusTransaction[]> {
    const map = new Map<string, HeliusTransaction[]>();

    for (const tx of transactions) {
      const wallets = new Set<string>();

      tx.tokenTransfers?.forEach((t) => {
        if (t.fromUserAccount) wallets.add(t.fromUserAccount);
        if (t.toUserAccount) wallets.add(t.toUserAccount);
      });
      tx.nativeTransfers?.forEach((t) => {
        if (t.fromUserAccount) wallets.add(t.fromUserAccount);
        if (t.toUserAccount) wallets.add(t.toUserAccount);
      });
      if (tx.events?.swap) {
        const s = tx.events.swap;
        if (s.nativeInput?.account) wallets.add(s.nativeInput.account);
        if (s.nativeOutput?.account) wallets.add(s.nativeOutput.account);
        if (s.tokenInputs?.[0]?.userAccount) wallets.add(s.tokenInputs[0].userAccount);
        if (s.tokenOutputs?.[0]?.userAccount) wallets.add(s.tokenOutputs[0].userAccount);
      }

      wallets.delete(mint);

      for (const wallet of wallets) {
        if (!wallet) continue;
        if (isKnownWallet(wallet)) continue;
        if (!map.has(wallet)) map.set(wallet, []);
        map.get(wallet)!.push(tx);
      }
    }

    return map;
  }

  private analyzeWallets(
    transactionsByWallet: Map<string, HeliusTransaction[]>,
    mint: string,
    validSet: Set<string>,
  ): Map<string, { tokensBought: number; solSpent: number; solReceived: number; transactionCount: number; firstTransaction: number; lastTransaction: number }> {
    const result = new Map<string, { tokensBought: number; solSpent: number; solReceived: number; transactionCount: number; firstTransaction: number; lastTransaction: number }>();

    for (const [walletAddress, walletTxs] of transactionsByWallet) {
      if (!validSet.has(walletAddress)) continue;
      try {
        const { analysisInputs } = mapHeliusTransactionsToIntermediateRecords(walletAddress, walletTxs);
        const relevant = (analysisInputs as any[]).filter((r) => r.mint === mint);
        if (relevant.length === 0) continue;

        const solSpent = relevant
          .filter((r) => r.direction === 'in')
          .reduce((s, r) => s + (r.associatedSolValue ?? 0), 0);
        const tokensBought = relevant
          .filter((r) => r.direction === 'in')
          .reduce((s, r) => s + Math.abs(r.amount ?? 0), 0);
        const solReceived = relevant
          .filter((r) => r.direction === 'out')
          .reduce((s, r) => s + (r.associatedSolValue ?? 0), 0);
        const timestamps = relevant.map((r) => r.timestamp).filter((t: number) => t > 0);

        result.set(walletAddress, {
          tokensBought,
          solSpent,
          solReceived,
          transactionCount: relevant.length,
          firstTransaction: timestamps.length ? Math.min(...timestamps) : 0,
          lastTransaction: timestamps.length ? Math.max(...timestamps) : 0,
        });
      } catch {
        // skip wallets that fail mapper
      }
    }

    return result;
  }
}
