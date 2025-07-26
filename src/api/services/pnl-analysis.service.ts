import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
// Re-export the core service or wrap it if it needs NestJS specific functionalities like logging or DI for its own dependencies
import { PnlAnalysisService as CorePnlAnalysisService } from '../../core/services/pnl-analysis-service';
import { DatabaseService } from '../services/database.service'; // NestJS-wrapped DatabaseService
import { HeliusApiClient } from '../../core/services/helius-api-client'; // Core HeliusApiClient type
import { SwapAnalysisSummary } from '../../types/helius-api';
import { TokenInfoService } from '../services/token-info.service';

@Injectable()
export class PnlAnalysisService {
  private readonly logger = new Logger(PnlAnalysisService.name);
  private corePnlAnalysisService: CorePnlAnalysisService;

  constructor(
    private databaseService: DatabaseService, // Injected NestJS DatabaseService
    private heliusApiClient: HeliusApiClient, // Injected HeliusApiClient (from HeliusModule)
    private tokenInfoService: TokenInfoService,
  ) {
    this.logger.debug('PnlAnalysisService (NestJS wrapper) constructor called.');
    this.logger.debug(`  DatabaseService injected: ${databaseService ? 'Yes' : 'No'}`)
    this.logger.debug(`  HeliusApiClient injected: ${heliusApiClient ? 'Yes' : 'No'}`)
    // CorePnlAnalysisService expects the core DatabaseService, but our NestJS DatabaseService extends it, so it's compatible.
    // CorePnlAnalysisService also expects HeliusApiClient, which we are injecting.
    this.corePnlAnalysisService = new CorePnlAnalysisService(
      this.databaseService, 
      this.heliusApiClient, 
      this.tokenInfoService
    );
    this.logger.debug('CorePnlAnalysisService instantiated within NestJS PnlAnalysisService wrapper.');
  }

  // Expose methods from the core service
  async analyzeWalletPnl(
    walletAddress: string,
    timeRange?: { startTs?: number; endTs?: number },
    options?: { isViewOnly?: boolean },
  ): Promise<(SwapAnalysisSummary & { runId?: number, analysisSkipped?: boolean, currentSolBalance?: number, balancesFetchedAt?: Date }) | null> {
    this.logger.debug(`[NestWrapper] analyzeWalletPnl called for ${walletAddress}`);
    return this.corePnlAnalysisService.analyzeWalletPnl(walletAddress, timeRange, options);
  }

  // Add other methods that need to be exposed
} 