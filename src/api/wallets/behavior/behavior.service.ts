import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService as NestDatabaseService } from '../../database/database.service'; // NestJS wrapped DB Service
import { BehaviorService as OriginalBehaviorService } from '../../../core/analysis/behavior/behavior-service';
import { BehaviorAnalysisConfig } from '@/types/analysis'; // Corrected to use path alias
import { BehavioralMetrics } from '@/types/behavior'; // Corrected to use path alias
import { DatabaseService as PrismaDatabaseService } from '../../../core/services/database-service'; // Original DB Service for original BehaviorService

@Injectable()
export class BehaviorService {
  private readonly logger = new Logger(BehaviorService.name);

  constructor(
    // Inject the NestJS wrapped DatabaseService for any direct DB calls THIS service might make (if any in future)
    private nestDatabaseService: NestDatabaseService 
  ) {}

  /**
   * Analyzes wallet behavior. This method instantiates the original BehaviorService.
   * It requires a BehaviorAnalysisConfig.
   */
  async getWalletBehavior(
    walletAddress: string,
    config: BehaviorAnalysisConfig, // Config will be required per call for now
    timeRange?: { startTs?: number; endTs?: number }
  ): Promise<BehavioralMetrics | null> {
    this.logger.debug(`Getting wallet behavior for ${walletAddress}`);
    
    // The original BehaviorService expects the original DatabaseService (not the NestJS one)
    // We need to ensure that the Prisma client instance is correctly handled.
    // The original DatabaseService instantiates its own logger and uses the global prisma client.
    // This should be acceptable for now.
    const prismaDbService = new PrismaDatabaseService(); 

    const originalService = new OriginalBehaviorService(prismaDbService, config);
    
    try {
      // Pass the timeRange from the parameters if provided, otherwise it relies on config or undefined
      return await originalService.analyzeWalletBehavior(walletAddress, timeRange || config.timeRange);
    } catch (error) {
      this.logger.error(`Error in getWalletBehavior for ${walletAddress}:`, error);
      throw error; // Re-throw for the controller to handle as an HTTP exception
    }
  }
  
  // Helper to get a default config if needed, or this can be managed by a config service later
  getDefaultBehaviorAnalysisConfig(): BehaviorAnalysisConfig {
    // Corrected default config based on BehaviorAnalysisConfig definition
    return {
      excludedMints: [],
      // timeRange can be set if there's a global default, otherwise undefined
      // timeRange: { startTs: undefined, endTs: undefined }
    };
  }
} 