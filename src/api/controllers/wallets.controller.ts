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
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

// Services from their respective feature folders
import { DatabaseService } from '../database/database.service';
import { BehaviorService } from '../wallets/behavior/behavior.service';
import { TokenPerformanceService, PaginatedTokenPerformanceResponse } from '../wallets/token_performance/token-performance.service';
import { PnlOverviewService, PnlOverviewResponse } from '../wallets/pnl_overview/pnl-overview.service';

// DTOs
import { TokenPerformanceQueryDto } from '../wallets/token_performance/token-performance-query.dto';

@ApiTags('Wallets')
@Controller('wallets')
export class WalletsController {
  private readonly logger = new Logger(WalletsController.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly behaviorService: BehaviorService,
    private readonly tokenPerformanceService: TokenPerformanceService,
    private readonly pnlOverviewService: PnlOverviewService,
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
    const requestParameters = { walletAddress: walletAddress, query: req.query }; 
    const startTime = Date.now();

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
      const walletInfo = await this.databaseService.getWallet(walletAddress);
      const advancedStats = await this.databaseService.getLatestAdvancedStatsByWallet(walletAddress);
      const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
      const behaviorMetrics = await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig);

      if (!advancedStats && !behaviorMetrics && !walletInfo) {
        this.logger.warn(`No data found for wallet summary: ${walletAddress}`);
        if (userId) {
          const durationMs = Date.now() - startTime;
          await this.databaseService.logActivity(userId, actionType, requestParameters, 'FAILURE', durationMs, 'Not Found', sourceIp);
        }
        throw new NotFoundException(`No summary data available for wallet ${walletAddress}`);
      }
      
      const lastActiveTimestamp = walletInfo?.newestProcessedTimestamp || advancedStats?.run?.runTimestamp?.getTime() / 1000 || null;
      const daysActive = '[Days Active - Placeholder]';

      const summary = {
        walletAddress,
        lastActiveTimestamp,
        daysActive,
        latestPnl: advancedStats?.medianPnlPerToken,
        winRate: advancedStats?.tokenWinRatePercent,
        behaviorClassification: behaviorMetrics?.tradingStyle || 'N/A',
        rawAdvancedStats: advancedStats, 
        rawBehaviorMetrics: behaviorMetrics,
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
  @ApiOperation({ summary: 'Get PNL overview for a wallet.' })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address', type: String })
  @ApiResponse({ status: 200, description: 'PNL overview retrieved successfully.', type: PnlOverviewResponse })
  @ApiResponse({ status: 404, description: 'Wallet not found or no PNL overview available.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  async getPnlOverview(@Param('walletAddress') walletAddress: string, @Req() req: Request & { user?: any }): Promise<PnlOverviewResponse> {
    const actionType = 'get_pnl_overview';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress: walletAddress, query: req.query };
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
      const pnlOverview = await this.pnlOverviewService.getPnlOverview(walletAddress);
      
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

      if (error instanceof NotFoundException || error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Error fetching PNL overview for wallet ${walletAddress} via service:`, error);
      throw new InternalServerErrorException('Failed to retrieve PNL overview.');
    }
  }
} 