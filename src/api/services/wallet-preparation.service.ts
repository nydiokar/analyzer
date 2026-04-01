import { Injectable, Logger } from '@nestjs/common';
import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { MarketContextService } from './market-context.service';

/**
 * Shared preparation layer that enforces the canonical
 * sync → enrich-swap-rows ordering before any wallet analysis.
 *
 * All full-wallet analysis paths (dashboard, holder-profile, similarity)
 * must call prepareWallet() before running PnL or behavior analysis to
 * guarantee that SwapAnalysisInput rows are enriched with market context
 * (SOL price + token supply) before canonical writers read from them.
 *
 * See: .ai/context/MARKET_CONTEXT_ORCHESTRATION_GAP_2026-03-31.md
 */
@Injectable()
export class WalletPreparationService {
  private readonly logger = new Logger(WalletPreparationService.name);

  constructor(
    private readonly heliusSyncService: HeliusSyncService,
    private readonly marketContextService: MarketContextService,
  ) {}

  /**
   * Sync wallet data then enrich all pending SwapAnalysisInput rows.
   *
   * @param walletAddress  The wallet to prepare.
   * @param syncOptions    Helius sync options. Pass undefined to skip sync
   *                       (enrich-only — use when the caller has already
   *                       determined sync is not needed).
   * @param enrichBatchSize  Rows per enrichment batch (default: 500).
   */
  async prepareWallet(
    walletAddress: string,
    syncOptions: SyncOptions | undefined,
    enrichBatchSize = 500,
  ): Promise<void> {
    if (syncOptions) {
      this.logger.debug(`[Prepare] Syncing wallet ${walletAddress}`);
      await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
      this.logger.debug(`[Prepare] Sync complete for ${walletAddress}`);
    } else {
      this.logger.debug(`[Prepare] Skipping sync for ${walletAddress} (up-to-date)`);
    }

    this.logger.debug(`[Prepare] Enriching market context for ${walletAddress}`);
    await this.marketContextService.enrichWallet(walletAddress, enrichBatchSize);
    this.logger.debug(`[Prepare] Preparation complete for ${walletAddress}`);
  }
}
