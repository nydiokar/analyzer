import {
  Controller,
  Get,
  Param,
  Query,
  UsePipes,
  ValidationPipe,
  NotFoundException,
  InternalServerErrorException,
  Logger,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard';

// Services from their respective feature folders
import { DatabaseService } from '../database/database.service';
import { BehaviorService } from '../wallets/behavior/behavior.service';
import { TokenPerformanceService, PaginatedTokenPerformanceResponse } from '../wallets/token_performance/token-performance.service';
import { PnlOverviewService, PnlOverviewResponse } from '../wallets/pnl_overview/pnl-overview.service';
import { WalletTimeRangeInfo } from '../../core/services/database-service';

// DTOs
import { TokenPerformanceQueryDto } from '../wallets/token_performance/token-performance-query.dto';
import { WalletSummaryResponse } from '../wallets/summary/wallet-summary-response.dto';
import { WalletSummaryQueryDto } from '../wallets/summary/wallet-summary-query.dto';
import { BehaviorAnalysisResponseDto } from '../wallets/behavior/behavior-analysis-response.dto';
import { BehaviorAnalysisQueryDto } from '../wallets/behavior/behavior-analysis-query.dto';
import { PnlOverviewQueryDto } from '../wallets/pnl_overview/pnl-overview-query.dto';
import { BehaviorAnalysisConfig } from '../../types/analysis';


@ApiTags('Wallets')
@Controller('wallets')
@UseGuards(ApiKeyAuthGuard)
export class WalletsController {
  private readonly logger = new Logger(WalletsController.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly behaviorService: BehaviorService,
    private readonly tokenPerformanceService: TokenPerformanceService,
    private readonly pnlOverviewService: PnlOverviewService,
  ) {}

  @Get(':walletAddress/summary')
  @ApiOperation({
    summary: 'Get a comprehensive summary for a Solana wallet.',
    description: 
      'Retrieves a wallet summary including latest activity, active duration, key performance indicators (KPIs) like PNL and token win rate, \n' +
      'a high-level behavior classification, and the raw advanced statistics and behavior metrics objects. \n' +
      'This endpoint serves as a primary overview for a wallet, combining data from multiple underlying analyses.'
  })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Wallet summary retrieved successfully. Provides a snapshot of wallet activity, performance, and behavior.',
    type: WalletSummaryResponse 
  })
  @ApiResponse({ status: 404, description: 'Wallet not found or no analysis data available to generate a summary.' })
  @ApiResponse({ status: 500, description: 'Internal server error encountered while generating wallet summary.' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async getWalletSummary(
    @Param('walletAddress') walletAddress: string, 
    @Query() queryDto: WalletSummaryQueryDto,
    @Req() req: Request & { user?: any }
  ) {
    const actionType = 'get_wallet_summary';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress: walletAddress, query: req.query, startDate: queryDto.startDate, endDate: queryDto.endDate }; 
    const startTime = Date.now();

    this.logger.debug(`getWalletSummary called for ${walletAddress} with query: ${JSON.stringify(queryDto)}`);

    // Prepare timeRange for services if dates are provided
    let serviceTimeRange: { startTs?: number; endTs?: number } | undefined = undefined;
    if (queryDto.startDate && queryDto.endDate) {
        const startTs = new Date(queryDto.startDate).getTime() / 1000;
        const endTs = new Date(queryDto.endDate).getTime() / 1000;
        if (!isNaN(startTs) && !isNaN(endTs)) {
            serviceTimeRange = { startTs, endTs };
        }
    }

    // Corrected log message to be more general for the getWalletSummary context
    this.logger.debug(`[WalletsController] Calculated serviceTimeRange: ${JSON.stringify(serviceTimeRange)} from queryDto: ${JSON.stringify(queryDto)}`);

    if (userId) {
      await this.databaseService.logActivity(
        userId,
        actionType,
        requestParameters,
        'INITIATED',
        undefined,
        undefined,
        sourceIp
      ).catch(err => this.logger.error('Failed to log INITIATED activity:', err));
    }

    try {
      // Fetch period-specific PNL and advanced stats using PnlAnalysisService in view-only mode
      const pnlSummaryForPeriod = await this.pnlOverviewService.getPnlAnalysisForSummary(walletAddress, serviceTimeRange);

      let periodSpecificTimestamps: WalletTimeRangeInfo | null = null;
      let overallWalletInfo: Awaited<ReturnType<typeof this.databaseService.getWallet>> | null = null;

      if (serviceTimeRange && serviceTimeRange.startTs && serviceTimeRange.endTs) {
        periodSpecificTimestamps = await this.databaseService.getWalletTimestampsForRange(walletAddress, {
            startTs: serviceTimeRange.startTs,
            endTs: serviceTimeRange.endTs,
        });
      } else {
        overallWalletInfo = await this.databaseService.getWallet(walletAddress);
      }
      
      const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig(); // Potentially adapt for time range in future
      const behaviorMetrics = await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig, serviceTimeRange);

      // Determine lastActiveTimestamp and daysActive
      let finalLastActiveTimestamp: number | null = null;
      let finalDaysActive: string | number = 0;

      if (periodSpecificTimestamps && periodSpecificTimestamps.lastObservedTsInPeriod) {
        finalLastActiveTimestamp = periodSpecificTimestamps.lastObservedTsInPeriod;
        if (periodSpecificTimestamps.firstObservedTsInPeriod) {
          // Check if the query range is ~24h or less
          const queryStart = queryDto.startDate ? new Date(queryDto.startDate).getTime() : 0;
          const queryEnd = queryDto.endDate ? new Date(queryDto.endDate).getTime() : 0;
          const queryDurationMs = queryEnd - queryStart;
          const twentyFourHoursMs = 24 * 60 * 60 * 1000;

          if (queryDurationMs > 0 && queryDurationMs <= twentyFourHoursMs + (2 * 60 * 60 * 1000)) { // Allow a small buffer (e.g., 2 hours) for exact 24h selections
            finalDaysActive = 1;
          } else {
            const diffSeconds = periodSpecificTimestamps.lastObservedTsInPeriod - periodSpecificTimestamps.firstObservedTsInPeriod;
            finalDaysActive = Math.max(1, Math.ceil(diffSeconds / (60 * 60 * 24))); // Ensure at least 1 day
          }
        } else if (finalLastActiveTimestamp) { // Activity in period, but no firstObservedTsInPeriod (e.g. single event)
            finalDaysActive = 1;
        }
      } else if (overallWalletInfo) {
        finalLastActiveTimestamp = overallWalletInfo.newestProcessedTimestamp || (pnlSummaryForPeriod?.advancedStats?.lastTransactionTimestamp || null) ;
        if (overallWalletInfo.firstProcessedTimestamp && finalLastActiveTimestamp) {
          const diffSeconds = finalLastActiveTimestamp - overallWalletInfo.firstProcessedTimestamp;
          finalDaysActive = Math.max(1, Math.ceil(diffSeconds / (60 * 60 * 24)));
        }
      } else if (pnlSummaryForPeriod?.advancedStats?.lastTransactionTimestamp) { // Fallback if no wallet info but PNL has it
          finalLastActiveTimestamp = pnlSummaryForPeriod.advancedStats.lastTransactionTimestamp;
          if (pnlSummaryForPeriod.advancedStats.firstTransactionTimestamp) {
            const diffSeconds = finalLastActiveTimestamp - pnlSummaryForPeriod.advancedStats.firstTransactionTimestamp;
            finalDaysActive = Math.max(1, Math.ceil(diffSeconds / (60 * 60 * 24)));
          } else {
            finalDaysActive = 1; // Active for at least one day if there's a last transaction
          }
      }

      if (!pnlSummaryForPeriod && !behaviorMetrics && !finalLastActiveTimestamp) {
        this.logger.warn(`No data found for wallet summary: ${walletAddress}`);
        if (userId) {
          const durationMs = Date.now() - startTime;
          await this.databaseService.logActivity(userId, actionType, requestParameters, 'FAILURE', durationMs, 'Not Found', sourceIp);
        }
        throw new NotFoundException(`No summary data available for wallet ${walletAddress}`);
      }

      const summary = {
        walletAddress,
        lastActiveTimestamp: finalLastActiveTimestamp,
        daysActive: finalDaysActive,
        latestPnl: pnlSummaryForPeriod?.realizedPnl, // Use PNL from period-specific analysis
        tokenWinRate: pnlSummaryForPeriod?.advancedStats?.tokenWinRatePercent, // Use win rate from period-specific analysis
        behaviorClassification: behaviorMetrics?.tradingStyle || 'N/A',
        receivedStartDate: queryDto.startDate || null,
        receivedEndDate: queryDto.endDate || null,
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

  @Get(':walletAddress/token-performance')
  @ApiOperation({
    summary: 'Get paginated token performance for a wallet',
    description: 
      'Retrieves a list of token performance records for the specified wallet, based on the most up-to-date data in AnalysisResult. \
       Supports pagination and sorting.'
  })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address', type: String })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved token performance data.',
    type: PaginatedTokenPerformanceResponse,
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters.' })
  @ApiResponse({ status: 404, description: 'Wallet not found or no analysis results available.' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async getLatestTokenPerformance(
    @Param('walletAddress') walletAddress: string,
    @Query() queryDto: TokenPerformanceQueryDto,
    @Req() req: Request & { user?: any },
  ): Promise<PaginatedTokenPerformanceResponse> {
    const actionType = 'get_latest_token_performance';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress, ...queryDto }; 
    const startTime = Date.now();

    if (userId) {
      this.databaseService.logActivity(
        userId,
        actionType,
        requestParameters,
        'INITIATED',
        undefined,
        undefined,
        sourceIp
      ).catch(err => this.logger.error(`Failed to log INITIATED activity for ${actionType}:`, err));
    }

    try {
      const result = await this.tokenPerformanceService.getPaginatedTokenPerformance(walletAddress, queryDto);
      
      if (userId) {
        const durationMs = Date.now() - startTime;
        this.databaseService.logActivity(userId, actionType, requestParameters, 'SUCCESS', durationMs, undefined, sourceIp)
          .catch(err => this.logger.error(`Failed to log SUCCESS activity for ${actionType}:`, err));
      }
      return result;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown internal server error';
      
      if (userId) {
        this.databaseService.logActivity(userId, actionType, { ...requestParameters, errorDetails: errorMessage }, 'FAILURE', durationMs, errorMessage, sourceIp)
          .catch(err => this.logger.error(`Failed to log FAILURE activity for ${actionType}:`, err));
      }

      if (error instanceof NotFoundException || error instanceof InternalServerErrorException) {
          throw error;
      }
      this.logger.error(`Error fetching latest token performance for wallet ${walletAddress}:`, error);
      throw new InternalServerErrorException('Failed to retrieve token performance data.');
    }
  }

  @Get(':walletAddress/pnl-overview')
  @ApiOperation({
    summary: 'Get a detailed Profit and Loss (PNL) overview for a wallet.',
    description: 
      'Provides a detailed breakdown of the wallet\'s profit and loss metrics, for all-time and optionally for a specified period. \n' +
      'This includes realized PNL, SOL spent/received, swap-level win rates, trade volumes, and various advanced trading statistics. \n' +
      'Data is derived from PNL analysis runs.'
  })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'PNL overview retrieved successfully, offering all-time and period-specific financial performance metrics.', 
    type: PnlOverviewResponse 
  })
  @ApiResponse({ status: 400, description: 'Invalid query parameters (e.g., date format).' })
  @ApiResponse({ status: 404, description: 'Wallet not found or no PNL overview data is available.' })
  @ApiResponse({ status: 500, description: 'Internal server error encountered while retrieving PNL overview.' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async getPnlOverview(
    @Param('walletAddress') walletAddress: string, 
    @Query() queryDto: PnlOverviewQueryDto,
    @Req() req: Request & { user?: any }
  ): Promise<PnlOverviewResponse> {
    const actionType = 'get_pnl_overview';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress: walletAddress, query: queryDto }; 
    const startTime = Date.now();

    if (userId) {
      this.databaseService.logActivity(
        userId,
        actionType,
        requestParameters,
        'INITIATED',
        undefined,
        undefined,
        sourceIp
      ).catch(err => this.logger.error(`Failed to log INITIATED activity for ${actionType}:`, err));
    }

    try {
      let serviceTimeRange: { startTs?: number; endTs?: number } | undefined = undefined;
      if (queryDto.startDate && queryDto.endDate) {
        const startTs = new Date(queryDto.startDate).getTime() / 1000;
        const endTs = new Date(queryDto.endDate).getTime() / 1000;
        if (!isNaN(startTs) && !isNaN(endTs) && endTs >= startTs) {
          serviceTimeRange = { startTs, endTs };
        } else {
          this.logger.warn(`Invalid date range provided for PNL overview: ${JSON.stringify(queryDto)}`);
        }
      }
      
      const pnlOverview = await this.pnlOverviewService.getPnlOverview(walletAddress, serviceTimeRange);
      
      if (userId) {
        const durationMs = Date.now() - startTime;
        await this.databaseService.logActivity(userId, actionType, requestParameters, 'SUCCESS', durationMs, undefined, sourceIp);
      }
      return pnlOverview;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
      if (userId) {
        await this.databaseService.logActivity(userId, actionType, {...requestParameters, errorDetails: errorMessage}, 'FAILURE', durationMs, errorMessage, sourceIp);
      }

      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error fetching PNL overview for wallet ${walletAddress}:`, error);
      throw new InternalServerErrorException('Failed to retrieve PNL overview.');
    }
  }

  @Get(':walletAddress/behavior-analysis')
  @ApiOperation({
    summary: 'Get detailed behavior analysis for a Solana wallet.',
    description:
      'Retrieves a detailed breakdown of the wallet\'s trading behavior. This includes trader classification, ' +
      'pattern timelines, consistency metrics, efficiency scores, strategic tags, temporal behavior details, and more, ' +
      'based on the latest available analysis data.',
  })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address', type: String })
  @ApiResponse({
    status: 200,
    description: 'Behavior analysis retrieved successfully.',
    type: BehaviorAnalysisResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Wallet not found or no behavior analysis data available.' })
  @ApiResponse({ status: 500, description: 'Internal server error encountered while retrieving behavior analysis.' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async getBehaviorAnalysis(
    @Param('walletAddress') walletAddress: string,
    @Query() queryDto: BehaviorAnalysisQueryDto,
    @Req() req: Request & { user?: any },
  ): Promise<BehaviorAnalysisResponseDto> {
    const actionType = 'get_behavior_analysis';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress: walletAddress, query: req.query, startDate: queryDto.startDate, endDate: queryDto.endDate }; 
    const startTime = Date.now();

    // Prepare timeRange for BehaviorService if dates are provided
    let serviceTimeRange: { startTs?: number; endTs?: number } | undefined = undefined;
    if (queryDto.startDate && queryDto.endDate) {
        const startTs = new Date(queryDto.startDate).getTime() / 1000;
        const endTs = new Date(queryDto.endDate).getTime() / 1000;
        if (!isNaN(startTs) && !isNaN(endTs)) {
            serviceTimeRange = { startTs, endTs };
        }
    }
    this.logger.debug(`[WalletsController] serviceTimeRange for BehaviorService: ${JSON.stringify(serviceTimeRange)} based on queryDto: ${JSON.stringify(queryDto)}`);

    if (userId) {
      this.databaseService.logActivity(
        userId,
        actionType,
        requestParameters,
        'INITIATED',
        undefined,
        undefined,
        sourceIp
      ).catch(err => this.logger.error(`Failed to log INITIATED activity for ${actionType}:`, err));
    }

    try {
      const config: BehaviorAnalysisConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
      // Pass the derived serviceTimeRange to getWalletBehavior
      const behaviorMetrics = await this.behaviorService.getWalletBehavior(walletAddress, config, serviceTimeRange);

      if (!behaviorMetrics) {
        this.logger.warn(`No behavior analysis data found for wallet: ${walletAddress}`);
        if (userId) {
          const durationMs = Date.now() - startTime;
          await this.databaseService.logActivity(userId, actionType, requestParameters, 'FAILURE', durationMs, 'Not Found', sourceIp);
        }
        throw new NotFoundException(`No behavior analysis data available for wallet ${walletAddress}`);
      }
      
      if (userId) {
        const durationMs = Date.now() - startTime;
        await this.databaseService.logActivity(userId, actionType, requestParameters, 'SUCCESS', durationMs, undefined, sourceIp);
      }
      return behaviorMetrics; // This should conform to BehaviorAnalysisResponseDto
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
      if (userId) {
        await this.databaseService.logActivity(userId, actionType, {...requestParameters, errorDetails: errorMessage}, 'FAILURE', durationMs, errorMessage, sourceIp);
      }

      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error fetching behavior analysis for wallet ${walletAddress}:`, error);
      throw new InternalServerErrorException('Failed to retrieve behavior analysis.');
    }
  }
} 