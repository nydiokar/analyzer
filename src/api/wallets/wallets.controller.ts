import { Controller, Get, Param, NotFoundException, InternalServerErrorException, Logger, Req } from '@nestjs/common';
import { Request } from 'express'; // Import Request
import { DatabaseService } from '../../database/database.service';
import { BehaviorService } from '../../behavior/behavior.service';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger'; // For OpenAPI documentation

@ApiTags('Wallets') // Tag for Swagger UI
@Controller('wallets') // Base path /api/v1/wallets
export class WalletsController {
  private readonly logger = new Logger(WalletsController.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly behaviorService: BehaviorService,
  ) {}

  @Get(':walletAddress/summary')
  @ApiOperation({ summary: 'Get a summary of a wallet including key metrics and behavior classification.' })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address', type: String })
  @ApiResponse({ status: 200, description: 'Wallet summary retrieved successfully.' })
  @ApiResponse({ status: 404, description: 'Wallet not found or no analysis data available.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getWalletSummary(@Param('walletAddress') walletAddress: string, @Req() req: Request & { user?: any }) {
    const actionType = 'get_wallet_summary';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    // Only log specific, relevant params, not all headers unless necessary
    const requestParameters = { walletAddress: walletAddress, query: req.query }; 
    const startTime = Date.now();

    if (userId) { // Log INITIATED only if user is identified
      await this.databaseService.logActivity(
        userId,
        actionType,
        requestParameters,
        'INITIATED',
        undefined,
        undefined,
        sourceIp
      ).catch(err => this.logger.error('Failed to log INITIATED activity:', err)); // Log and continue if initial log fails
    }

    try {
      // 1. Fetch basic wallet info (including newestProcessedTimestamp for "Last Active")
      const walletInfo = await this.databaseService.getWallet(walletAddress);
      // if (!walletInfo) {
      //   this.logger.warn(`Wallet not found in DB: ${walletAddress}`);
      //   // Consider if a wallet record MUST exist. If not, can proceed if other data exists.
      //   // For now, let other services determine if data is sufficient.
      // }

      // 2. Fetch latest AdvancedStatsResult for the wallet
      // This requires finding the latest AnalysisRun for the wallet, then its AdvancedStatsResult.
      // Or, querying AdvancedStatsResult directly, ordered by a timestamp or runId (desc).
      // Let's assume a method in DatabaseService: getLatestAdvancedStats(walletAddress)
      // This method needs to be implemented in DatabaseService.
      const advancedStats = await this.databaseService.getLatestAdvancedStatsByWallet(walletAddress);

      // 3. Get behavior classification
      const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
      // Note: The timeRange for behavior analysis might need to align with the latest AnalysisRun or be a standard window.
      // For now, using default config without specific timeRange, relying on analyzeWalletBehavior's default or overall data.
      const behaviorMetrics = await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig);

      if (!advancedStats && !behaviorMetrics && !walletInfo) {
        // If no data at all can be found for this wallet from any source
        this.logger.warn(`No data found for wallet summary: ${walletAddress}`);
        // Log FAILURE if appropriate before throwing NotFoundException
        if (userId) {
          const durationMs = Date.now() - startTime;
          await this.databaseService.logActivity(userId, actionType, requestParameters, 'FAILURE', durationMs, 'Not Found', sourceIp);
        }
        throw new NotFoundException(`No summary data available for wallet ${walletAddress}`);
      }
      
      // 4. Determine "Last Active Timestamp"
      const lastActiveTimestamp = walletInfo?.newestProcessedTimestamp || advancedStats?.run?.runTimestamp?.getTime() / 1000 || null;
      // Note: newestProcessedTimestamp is Int?, runTimestamp is DateTime.
      // The above is a basic heuristic. A more robust solution for last active might be needed.

      // 5. Determine "Days Active" - Placeholder as per plan
      // "This may require pre-calculation ... Avoid complex on-the-fly calculations in the API ..."
      const daysActive = '[Days Active - Placeholder]'; // Placeholder

      // 6. Assemble summary response
      const summary = {
        walletAddress,
        lastActiveTimestamp, // Unix timestamp (seconds)
        daysActive,
        latestPnl: advancedStats?.medianPnlPerToken, // Example from AdvancedStatsResult
        winRate: advancedStats?.tokenWinRatePercent, // Example from AdvancedStatsResult
        behaviorClassification: behaviorMetrics?.tradingStyle || 'N/A', // Corrected field
        // Add other relevant fields from walletInfo, advancedStats, behaviorMetrics
        rawAdvancedStats: advancedStats, // Optional: include raw data
        rawBehaviorMetrics: behaviorMetrics, // Optional: include raw data
      };

      if (userId) {
        const durationMs = Date.now() - startTime;
        await this.databaseService.logActivity(userId, actionType, requestParameters, 'SUCCESS', durationMs, undefined, sourceIp);
      }
      return summary;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
      if (userId) {
        await this.databaseService.logActivity(userId, actionType, {...requestParameters, errorDetails: errorMessage}, 'FAILURE', durationMs, errorMessage, sourceIp);
      }

      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error fetching summary for wallet ${walletAddress}:`, error);
      throw new InternalServerErrorException('Failed to retrieve wallet summary.');
    }
  }
} 