import { Injectable, Logger } from '@nestjs/common';

export type OptimizationHint = 'small' | 'large' | 'massive';
export type ProcessingStrategy = 'sync' | 'background' | 'hybrid';

export interface EnrichmentStrategyConfig {
  smallThreshold: number;
  largeThreshold: number;
  massiveThreshold: number;
}

@Injectable()
export class EnrichmentStrategyService {
  private readonly logger = new Logger(EnrichmentStrategyService.name);
  
  // Default thresholds - can be made configurable via environment variables
  private readonly config: EnrichmentStrategyConfig = {
    smallThreshold: 100,
    largeThreshold: 1000,
    massiveThreshold: 10000,
  };

  /**
   * Determines the optimization hint based on total token count
   * @param totalTokens - Total number of tokens to process
   * @returns Optimization hint for the enrichment process
   */
  determineOptimizationHint(totalTokens: number): OptimizationHint {
    if (totalTokens > this.config.massiveThreshold) {
      this.logger.debug(`Token count ${totalTokens} exceeds massive threshold (${this.config.massiveThreshold}). Using 'massive' optimization.`);
      return 'massive';
    } else if (totalTokens > this.config.largeThreshold) {
      this.logger.debug(`Token count ${totalTokens} exceeds large threshold (${this.config.largeThreshold}). Using 'large' optimization.`);
      return 'large';
    } else {
      this.logger.debug(`Token count ${totalTokens} is below large threshold (${this.config.largeThreshold}). Using 'small' optimization.`);
      return 'small';
    }
  }

  /**
   * Maps optimization hint to processing strategy
   * This method provides consistency with the processor's strategy mapping
   * @param hint - The optimization hint
   * @returns Processing strategy for the enrichment job
   */
  mapOptimizationHintToStrategy(hint: OptimizationHint): ProcessingStrategy {
    switch (hint) {
      case 'small':
        return 'sync';
      case 'large':
        return 'hybrid';
      case 'massive':
        return 'background';
      default:
        this.logger.warn(`Unknown optimization hint: ${hint}. Defaulting to 'sync' strategy.`);
        return 'sync';
    }
  }

  /**
   * Gets the current strategy configuration
   * @returns Current enrichment strategy configuration
   */
  getStrategyConfig(): EnrichmentStrategyConfig {
    return { ...this.config };
  }

  /**
   * Provides a human-readable description of the strategy
   * @param hint - The optimization hint
   * @returns Description of what the strategy does
   */
  getStrategyDescription(hint: OptimizationHint): string {
    const strategy = this.mapOptimizationHintToStrategy(hint);
    
    switch (strategy) {
      case 'sync':
        return 'Synchronous processing - all tokens enriched before job completion';
      case 'hybrid':
        return 'Hybrid processing - existing tokens enriched synchronously, new tokens processed in background';
      case 'background':
        return 'Background processing - prioritizes speed over completeness, full enrichment happens asynchronously';
      default:
        return 'Unknown strategy';
    }
  }
} 