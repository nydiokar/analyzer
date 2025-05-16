import { BehaviorAnalyzer } from 'core/analysis/behavior/analyzer';
import { DatabaseService } from 'core/services/database-service'; // Assuming export will be fixed
import { BehaviorAnalysisConfig } from '@/types/analysis';
import { BehavioralMetrics } from '@/types/behavior';
import { createLogger } from 'core/utils/logger';

const logger = createLogger('BehaviorService');

export class BehaviorService {
  private behaviorAnalyzer: BehaviorAnalyzer;

  constructor(
    private databaseService: DatabaseService,
    private config: BehaviorAnalysisConfig
  ) {
    this.behaviorAnalyzer = new BehaviorAnalyzer(config); // Pass specific config
    logger.info('BehaviorService instantiated');
  }

  /**
   * Analyzes the trading behavior for a given wallet address.
   * Fetches data, performs calculations using BehaviorAnalyzer, and returns metrics.
   * 
   * @param walletAddress - The Solana wallet address to analyze.
   * @param timeRange - Optional time range to limit the analysis (unix timestamps).
   * @returns Promise resolving to BehavioralMetrics or null if no data.
   */
  async analyzeWalletBehavior(
    walletAddress: string,
    timeRange?: { startTs?: number; endTs?: number }
  ): Promise<BehavioralMetrics | null> {
    logger.info(`Analyzing trading behavior for wallet ${walletAddress}`);

    try {
      // Fetch swap records using the injected DatabaseService
      const swapRecords = await this.databaseService.getSwapAnalysisInputs(walletAddress, timeRange);

      if (!swapRecords || swapRecords.length === 0) {
        logger.warn(`No swap records found for wallet ${walletAddress} within the specified time range.`);
        // Return null instead of empty metrics to signify no data found for analysis
        return null; 
        // Alternatively, return behaviorAnalyzer.getEmptyMetrics() if that's preferred downstream
      }

      // Use the injected BehaviorAnalyzer for calculations
      // Assuming BehaviorAnalyzer has a public method `analyze` that takes raw swap records
      // and orchestrates the internal steps (build sequences, calc metrics, classify).
      const metrics = this.behaviorAnalyzer.analyze(swapRecords); 

      // // 1. Build token sequences (Assuming analyzer handles this)
      // // This might be internal to calculateBehavioralMetrics or a separate public method
      // // Let's assume calculateBehavioralMetrics takes swapRecords directly for now
      // 
      // // 2. Calculate core metrics (Main analysis method)
      // const metrics = this.behaviorAnalyzer.calculateBehavioralMetrics(swapRecords); // Pass raw swaps
      // 
      // // 3. Classify trading style (Assuming analyzer handles this)
      // // This might be part of calculateBehavioralMetrics or a separate method
      // // Let's assume calculateBehavioralMetrics returns metrics including style
      // 
      // // If classification is separate:
      // // this.behaviorAnalyzer.classifyTradingStyle(metrics); 

      logger.info(`Completed behavior analysis for ${walletAddress}`);
      return metrics;

    } catch (error) {
      logger.error(`Error analyzing behavior for wallet ${walletAddress}:`, { error });
      // Decide on error handling: re-throw, return null, return empty metrics?
      // Returning null is consistent with the "no data" case.
      return null;
    }
  }
} 