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
  Post,
  Body,
  Delete,
  HttpCode,
  Patch,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

// Services from their respective feature folders
import { DatabaseService } from '../../database/database.service';
import { BehaviorService } from '../../wallets/behavior/behavior.service'; 
import { TokenPerformanceService, PaginatedTokenPerformanceResponse } from '../../wallets/token_performance/token-performance.service';
import { PnlOverviewService, PnlOverviewResponse } from '../../wallets/pnl_overview/pnl-overview.service';
import { TokenInfoService } from '../../token-info/token-info.service';
import { WalletClassificationService } from '../../../core/services/wallet-classification.service';
import { SmartFetchService } from '../../../core/services/smart-fetch-service';


// DTOs
import { TokenPerformanceQueryDto } from '../../wallets/token_performance/token-performance-query.dto';
import { WalletSummaryResponse } from '../../wallets/summary/wallet-summary-response.dto';
import { WalletSummaryQueryDto } from '../../wallets/summary/wallet-summary-query.dto';
import { BehaviorAnalysisResponseDto } from '../../wallets/behavior/behavior-analysis-response.dto';
import { BehaviorAnalysisQueryDto } from '../../wallets/behavior/behavior-analysis-query.dto';
import { PnlOverviewQueryDto } from '../../wallets/pnl_overview/pnl-overview-query.dto';
import { BehaviorAnalysisConfig } from '../../../types/analysis';
import { CreateNoteDto } from '../../wallets/notes/create-note.dto';
import { UpdateNoteDto } from '../../wallets/notes/update-note.dto';
import { WalletSearchQueryDto } from '../../wallets/search/wallet-search-query.dto';
import { WalletSearchResultsDto, WalletSearchResultItemDto } from '../../wallets/search/wallet-search-result.dto';


@ApiTags('Wallets')
@Controller('wallets')
export class WalletsController {
  private readonly logger = new Logger(WalletsController.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly behaviorService: BehaviorService,
    private readonly tokenPerformanceService: TokenPerformanceService,
    private readonly pnlOverviewService: PnlOverviewService,
    private readonly tokenInfoService: TokenInfoService,
    private readonly classificationService: WalletClassificationService,
    private readonly smartFetchService: SmartFetchService,
  ) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search for wallets by address fragment.',
    description: 'Returns a list of wallet addresses that partially match the given query string.',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved matching wallet addresses.',
    type: WalletSearchResultsDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid search query.' })
  @ApiResponse({ status: 500, description: 'Internal server error during search.' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async searchWallets(
    @Query() queryDto: WalletSearchQueryDto,
    @Req() req: Request & { user?: any }
  ): Promise<WalletSearchResultsDto> {
    const actionType = 'search_wallets';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { query: queryDto.query };
    const startTime = Date.now();

    if (userId) {
      this.databaseService.logActivity(userId, actionType, requestParameters, 'INITIATED', undefined, undefined, sourceIp)
        .catch(err => this.logger.error(`Failed to log INITIATED activity for ${actionType}:`, err));
    }

    try {
      const results = await this.databaseService.searchWalletsByAddressFragment(queryDto.query);
      const mappedResults: WalletSearchResultItemDto[] = results.map(wallet => ({ address: wallet.address }));
      
      if (userId) {
        const durationMs = Date.now() - startTime;
        this.databaseService.logActivity(userId, actionType, requestParameters, 'SUCCESS', durationMs, undefined, sourceIp)
          .catch(err => this.logger.error(`Failed to log SUCCESS activity for ${actionType}:`, err));
      }
      return { wallets: mappedResults };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown internal server error';
      if (userId) {
        this.databaseService.logActivity(userId, actionType, { ...requestParameters, errorDetails: errorMessage }, 'FAILURE', durationMs, errorMessage, sourceIp)
          .catch(err => this.logger.error(`Failed to log FAILURE activity for ${actionType}:`, err));
      }
      this.logger.error(`Error searching wallets with query "${queryDto.query}":`, error);
      if (error instanceof InternalServerErrorException) { // From DatabaseService
          throw error;
      }
      throw new InternalServerErrorException('Failed to search wallets.');
    }
  }

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
  ): Promise<WalletSummaryResponse> {
    const actionType = 'get_wallet_summary';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress: walletAddress, query: req.query, startDate: queryDto.startDate, endDate: queryDto.endDate }; 
    const startTime = Date.now();

    this.logger.debug(`getWalletSummary called for ${walletAddress} with query: ${JSON.stringify(queryDto)}`);

    // Prepare timeRange for specific period data if dates are provided
    let serviceTimeRange: { startTs?: number; endTs?: number } | undefined = undefined;
    if (queryDto.startDate && queryDto.endDate) {
        const startTs = new Date(queryDto.startDate).getTime() / 1000;
        const endTs = new Date(queryDto.endDate).getTime() / 1000;
        if (!isNaN(startTs) && !isNaN(endTs)) {
            serviceTimeRange = { startTs, endTs };
        }
    }
    this.logger.debug(`ServiceTimeRange for period-specific data (if any): ${JSON.stringify(serviceTimeRange)}`);

    if (userId) {
      await this.databaseService.logActivity(userId, actionType, requestParameters, 'INITIATED', undefined, undefined, sourceIp)
        .catch(err => this.logger.error('Failed to log INITIATED activity:', err));
    }

    try {
      // 1. Find or create the wallet entity to ensure it's tracked.
      const wallet = await this.databaseService.ensureWalletExists(walletAddress);

      // DEMO USER CHECK - This is now handled by the ApiKeyAuthGuard
      // const user = req.user;
      // if (user && user.isDemo && !(wallet as any).isDemo) {
      //   this.logger.warn(`Restricted access for demo user ${user.id} on non-demo wallet ${walletAddress}.`);
      //   return {
      //     status: 'restricted',
      //     walletAddress: walletAddress,
      //   };
      // }
      
      // 2. Fetch the main persisted PNL Summary for overall KPIs.
      const overallPnlSummary = await this.databaseService.getWalletPnlSummaryWithRelations(walletAddress);

      if (!overallPnlSummary) {
        this.logger.warn(`No WalletPnlSummary found for wallet: ${walletAddress}. Returning 'unanalyzed' state.`);
        return {
          status: 'unanalyzed',
          walletAddress: walletAddress,
        };
      }

      // 2. Fetch the main persisted Behavior Profile
      const overallBehaviorProfile = await this.databaseService.getWalletBehaviorProfile(walletAddress);
      
      // 3. Determine lastAnalyzedAt from the PNL summary's updatedAt field
      const lastAnalyzedAt = overallPnlSummary.updatedAt;

      // 4. Use data from these persisted overall summaries
      let latestPnl = overallPnlSummary.realizedPnl ?? 0; // Or netPnl
      let tokenWinRate = overallPnlSummary.advancedStats?.tokenWinRatePercent;
      let behaviorClassification = overallBehaviorProfile?.tradingStyle || 'N/A';
      let currentSolBalance = overallPnlSummary.currentSolBalance;
      let balancesFetchedAt = overallPnlSummary.solBalanceFetchedAt;
      
      // For lastActiveTimestamp and daysActive, use overall wallet info if available
      // Fallback to PNL summary timestamps if wallet entity doesn't have them directly or is not fetched
      let finalLastActiveTimestamp = overallPnlSummary.wallet?.newestProcessedTimestamp || overallPnlSummary.advancedStats?.lastTransactionTimestamp || null;
      let finalDaysActive: string | number = 0;
      const firstProcessedOverallTs = overallPnlSummary.wallet?.firstProcessedTimestamp || overallPnlSummary.advancedStats?.firstTransactionTimestamp || null;

      if (firstProcessedOverallTs && finalLastActiveTimestamp) {
        const diffSeconds = finalLastActiveTimestamp - firstProcessedOverallTs;
        finalDaysActive = Math.max(1, Math.ceil(diffSeconds / (60 * 60 * 24)));
      } else if (finalLastActiveTimestamp) {
        finalDaysActive = 1; // Active for at least one day if there's a last transaction
      }

      // ---- Optional: Handle period-specific data if serviceTimeRange is provided ----
      // This part can be added if specific KPIs for the selected time range are still needed
      // AND can be fetched efficiently (e.g., from AnalysisResult or a lightweight PnlOverviewService call
      // that *doesn't* re-trigger full balance fetches and core PnlAnalysisService.analyzeWalletPnl).
      // For now, the primary summary uses overall persisted data.
      // If serviceTimeRange is present, one might choose to call a *different*, more lightweight method
      // on PnlOverviewService or BehaviorService that works primarily with indexed AnalysisResult entries.
      // Example:
      // let periodSpecificPnl: number | undefined;
      // if (serviceTimeRange) {
      //   const periodPnlData = await this.pnlOverviewService.getLightweightPnlForPeriod(walletAddress, serviceTimeRange);
      //   periodSpecificPnl = periodPnlData?.realizedPnl;
      //   // Potentially override latestPnl if period data is specifically requested to be the focus.
      // }
      // For simplicity in this refactor, we primarily use the overallPnlSummary for KPIs.
      // The frontend time range selector influences other tabs more directly (Token Performance, PNL Overview tab).

      // Get wallet classification for frontend display with auto-classification
      const finalClassification = await this.smartFetchService.getOrAutoClassifyWallet(walletAddress);

      const summary: WalletSummaryResponse = {
        status: 'ok',
        walletAddress,
        lastAnalyzedAt: lastAnalyzedAt.toISOString(),
        lastActiveTimestamp: finalLastActiveTimestamp,
        daysActive: finalDaysActive,
        latestPnl: latestPnl,
        tokenWinRate: tokenWinRate,
        behaviorClassification: behaviorClassification,
        classification: finalClassification,
        currentSolBalance: currentSolBalance,
        balancesFetchedAt: balancesFetchedAt ? balancesFetchedAt.toISOString() : null,
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

  @Post(':walletAddress/notes')
  @ApiOperation({
    summary: 'Create a new note for a specific wallet.',
    description: 'Allows an authenticated user to add a textual note to a given wallet address.'
  })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address for which to add the note', type: String })
  @ApiResponse({ status: 201, description: 'Note created successfully.' })
  @ApiResponse({ status: 400, description: 'Invalid input data for the note.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Wallet not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error while creating the note.' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async createWalletNote(
    @Param('walletAddress') walletAddress: string,
    @Body() createNoteDto: CreateNoteDto,
    @Req() req: Request & { user?: any }
  ) {
    const actionType = 'create_wallet_note';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress, noteContent: createNoteDto.content };
    const startTime = Date.now();

    if (!userId) {
      this.logger.error('User ID not found in request. This should not happen if AuthGuard is effective.');
      throw new InternalServerErrorException('User identification failed.');
    }

    this.logger.debug(`Attempting to create note for wallet ${walletAddress} by user ${userId}`);

    await this.databaseService.logActivity(
      userId,
      actionType,
      requestParameters,
      'INITIATED',
      undefined,
      undefined,
      sourceIp
    ).catch(err => this.logger.error('Failed to log INITIATED activity for createWalletNote:', err));

    try {
      // First, check if the wallet exists to provide a clear 404 if not.
      const walletExists = await this.databaseService.getWallet(walletAddress);
      if (!walletExists) {
        throw new NotFoundException(`Wallet with address ${walletAddress} not found.`);
      }

      const note = await this.databaseService.createWalletNote(
        walletAddress,
        userId,
        createNoteDto.content
      );

      const durationMs = Date.now() - startTime;
      await this.databaseService.logActivity(userId, actionType, requestParameters, 'SUCCESS', durationMs, undefined, sourceIp);
      
      this.logger.log(`Note created successfully for wallet ${walletAddress} by user ${userId}, Note ID: ${note.id}`);
      return note; // Or a more structured response, like { message: 'Note created', noteId: note.id }
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
      await this.databaseService.logActivity(userId, actionType, {...requestParameters, errorDetails: errorMessage}, 'FAILURE', durationMs, errorMessage, sourceIp);

      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error creating note for wallet ${walletAddress} by user ${userId}:`, error);
      throw new InternalServerErrorException('Failed to create note.');
    }
  }

  @Get(':walletAddress/notes')
  @ApiOperation({
    summary: 'Get all notes for a specific wallet.',
    description: 'Retrieves all notes associated with a given wallet address, ordered by creation date (newest first).'
  })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address for which to retrieve notes', type: String })
  @ApiResponse({ status: 200, description: 'Notes retrieved successfully.', type: [Object] }) // Update type if a specific DTO is made for notes list
  @ApiResponse({ status: 401, description: 'Unauthorized, API key missing or invalid.' })
  @ApiResponse({ status: 404, description: 'Wallet not found or no notes available.' })
  @ApiResponse({ status: 500, description: 'Internal server error while retrieving notes.' })
  async getWalletNotes(
    @Param('walletAddress') walletAddress: string,
    @Req() req: Request & { user?: any }
  ) {
    const actionType = 'get_wallet_notes';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress };
    const startTime = Date.now();

    if (!userId) {
      // This case should ideally be prevented by the ApiKeyAuthGuard
      this.logger.error('User ID not found in request for getWalletNotes.');
      throw new InternalServerErrorException('User identification failed.');
    }

    this.logger.debug(`Attempting to retrieve notes for wallet ${walletAddress} by user ${userId}`);

    await this.databaseService.logActivity(
      userId,
      actionType,
      requestParameters,
      'INITIATED',
      undefined,
      undefined,
      sourceIp
    ).catch(err => this.logger.error('Failed to log INITIATED activity for getWalletNotes:', err));

    try {
      // Check if wallet exists first for a cleaner 404 if it doesn't, though getWalletNotes might also handle this implicitly
      const walletExists = await this.databaseService.getWallet(walletAddress);
      if (!walletExists) {
          throw new NotFoundException(`Wallet with address ${walletAddress} not found.`);
      }

      const notes = await this.databaseService.getWalletNotes(walletAddress, userId);
      // if (!notes || notes.length === 0) {
      //   // Decide if an empty array is a 404 or a 200 with empty array. Typically 200.
      //   // throw new NotFoundException(`No notes found for wallet ${walletAddress}`);
      // }

      const durationMs = Date.now() - startTime;
      await this.databaseService.logActivity(userId, actionType, requestParameters, 'SUCCESS', durationMs, undefined, sourceIp);
      
      this.logger.log(`${notes.length} notes retrieved for wallet ${walletAddress} by user ${userId}`);
      return notes;
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
      await this.databaseService.logActivity(userId, actionType, {...requestParameters, errorDetails: errorMessage}, 'FAILURE', durationMs, errorMessage, sourceIp);
      
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Error retrieving notes for wallet ${walletAddress} by user ${userId}:`, error);
      throw new InternalServerErrorException('Failed to retrieve notes.');
    }
  }

  @Delete(':walletAddress/notes/:noteId')
  @HttpCode(204) // Indicate successful deletion with no content to return
  @ApiOperation({
    summary: 'Delete a specific note for a wallet.',
    description: 'Allows an authenticated user to delete their own note associated with a given wallet address and note ID.'
  })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address (used for context, not for lookup here)', type: String })
  @ApiParam({ name: 'noteId', description: 'The ID of the note to delete', type: String })
  @ApiResponse({ status: 204, description: 'Note deleted successfully.' })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key missing or invalid.' })
  @ApiResponse({ status: 403, description: 'Forbidden. User does not own this note or note not found under user.' })
  @ApiResponse({ status: 404, description: 'Note not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error while deleting the note.' })
  async deleteWalletNote(
    @Param('walletAddress') walletAddress: string, // Kept for URL structure consistency, but noteId is primary for lookup
    @Param('noteId') noteId: string,
    @Req() req: Request & { user?: any }
  ) {
    const actionType = 'delete_wallet_note';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress, noteId }; // Log both for context
    const startTime = Date.now();

    if (!userId) {
      this.logger.error('User ID not found in request (deleteWalletNote). This should be caught by AuthGuard.');
      throw new InternalServerErrorException('User identification failed.');
    }

    this.logger.debug(`Attempting to delete note ${noteId} for wallet ${walletAddress} by user ${userId}`);

    await this.databaseService.logActivity(
      userId,
      actionType,
      requestParameters,
      'INITIATED',
      undefined,
      undefined,
      sourceIp
    ).catch(err => this.logger.error('Failed to log INITIATED activity for deleteWalletNote:', err));

    try {
      const deletedNote = await this.databaseService.deleteWalletNote(noteId, userId);

      if (!deletedNote) {
        // This case should ideally be handled by NotFoundException thrown from the service if note doesn't exist or doesn't belong to user
        // For safety, if service returns null without throwing specific NotFoundException for permission issues.
        this.logger.warn(`Note ${noteId} not found for deletion by user ${userId}, or permission denied at service level without specific exception.`);
        throw new NotFoundException('Note not found or you do not have permission to delete it.');
      }

      const durationMs = Date.now() - startTime;
      await this.databaseService.logActivity(userId, actionType, requestParameters, 'SUCCESS', durationMs, undefined, sourceIp);
      
      this.logger.log(`Note ${noteId} deleted successfully by user ${userId}`);
      // No content to return for a 204 response
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
      await this.databaseService.logActivity(userId, actionType, {...requestParameters, errorDetails: errorMessage}, 'FAILURE', durationMs, errorMessage, sourceIp);

      if (error instanceof NotFoundException) {
        // If the service specifically threw NotFoundException (e.g. user does not own note, or note truly not found)
        throw error; // Re-throw to send 404 or appropriate status defined by service error
      }
      // For other errors from service or unexpected errors here
      this.logger.error(`Error deleting note ${noteId} for wallet ${walletAddress} by user ${userId}:`, error);
      throw new InternalServerErrorException('Failed to delete note.');
    }
  }

  @Patch(':walletAddress/notes/:noteId')
  @ApiOperation({
    summary: 'Update an existing note for a wallet.',
    description: 'Allows an authenticated user to update the content of their own note.'
  })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address associated with the note', type: String })
  @ApiParam({ name: 'noteId', description: 'The ID of the note to update', type: String })
  @ApiResponse({ status: 200, description: 'Note updated successfully.' }) // Can return the updated note object
  @ApiResponse({ 
    status: 400, 
    description: 'Invalid input data for the note (e.g., empty content if made required). Or if content is missing and it\'s the only updatable field.' 
  })
  @ApiResponse({ status: 401, description: 'Unauthorized, API key missing or invalid.' })
  @ApiResponse({ status: 403, description: 'Forbidden. User does not own this note.' })
  @ApiResponse({ status: 404, description: 'Note not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error while updating the note.' })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
  async updateWalletNote(
    @Param('walletAddress') walletAddress: string, 
    @Param('noteId') noteId: string,
    @Body() updateNoteDto: UpdateNoteDto,
    @Req() req: Request & { user?: any }
  ) {
    const actionType = 'update_wallet_note';
    const userId = req.user?.id;
    const sourceIp = req.ip;
    const requestParameters = { walletAddress, noteId, newContent: updateNoteDto.content };
    const startTime = Date.now();

    if (!userId) {
      this.logger.error('User ID not found in request (updateWalletNote).');
      throw new InternalServerErrorException('User identification failed.');
    }

    if (!updateNoteDto.content || updateNoteDto.content.trim() === '') {
        throw new InternalServerErrorException('Note content cannot be empty.');
    }

    this.logger.debug(`Attempting to update note ${noteId} for wallet ${walletAddress} by user ${userId}`);

    await this.databaseService.logActivity(
      userId,
      actionType,
      requestParameters,
      'INITIATED',
      undefined,
      undefined,
      sourceIp
    ).catch(err => this.logger.error('Failed to log INITIATED activity for updateWalletNote:', err));

    try {
      const updatedNote = await this.databaseService.updateWalletNote(
        noteId,
        userId,
        updateNoteDto.content
      );

      const durationMs = Date.now() - startTime;
      await this.databaseService.logActivity(userId, actionType, requestParameters, 'SUCCESS', durationMs, undefined, sourceIp);
      
      this.logger.log(`Note ${noteId} updated successfully for wallet ${walletAddress} by user ${userId}`);
      return updatedNote; 
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown server error';
      await this.databaseService.logActivity(userId, actionType, {...requestParameters, errorDetails: errorMessage}, 'FAILURE', durationMs, errorMessage, sourceIp);

      if (error instanceof NotFoundException || error instanceof InternalServerErrorException) {
        throw error; 
      }
      this.logger.error(`Error updating note ${noteId} for wallet ${walletAddress} by user ${userId}:`, error);
      throw new InternalServerErrorException('Failed to update note.');
    }
  }

  @Get(':walletAddress/classification')
  @ApiOperation({
    summary: 'Get wallet classification and smart fetch status',
    description: 'Returns classification status and fetch limitations for high-frequency wallets',
  })
  @ApiParam({ name: 'walletAddress', description: 'Wallet address to check classification for' })
  @ApiResponse({ status: 200, description: 'Wallet classification retrieved successfully' })
  async getWalletClassification(
    @Param('walletAddress') walletAddress: string,
    @Req() req: Request & { user?: any },
  ) {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User could not be identified.');
    }

    try {
      // Log activity
      await this.databaseService.logActivity(
        userId,
        'get_wallet_classification',
        { walletAddress },
        'SUCCESS'
      );

      // Use centralized auto-classification logic
      const finalClassification = await this.smartFetchService.getOrAutoClassifyWallet(walletAddress);
      const recommendation = await this.classificationService.getSmartFetchRecommendation(walletAddress);
      
      return {
        walletAddress,
        classification: finalClassification,
        smartFetch: {
          shouldLimitFetch: recommendation.shouldLimitFetch,
          maxSignatures: recommendation.maxSignatures,
          reason: recommendation.reason,
          cacheHours: recommendation.cacheHours,
        },
        message: recommendation.shouldLimitFetch 
          ? `This wallet shows high-frequency activity patterns. Transaction analysis is limited to ${recommendation.maxSignatures} recent transactions to improve performance.`
          : 'Normal transaction analysis applied.',
      };
    } catch (error) {
      this.logger.error(`Error getting classification for wallet ${walletAddress}:`, error);
      
      // Log failed activity
      await this.databaseService.logActivity(
        userId,
        'get_wallet_classification',
        { walletAddress },
        'FAILURE',
        undefined,
        error instanceof Error ? error.message : 'Unknown error'
      );

      throw new InternalServerErrorException('Failed to retrieve wallet classification');
    }
  }

  @Post(':walletAddress/enrich-all-tokens')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Trigger enrichment for all tokens of a wallet',
    description:
      'Finds all unique token addresses from the analysis results for a given wallet and triggers a background job to fetch their metadata. This is a fire-and-forget operation.',
  })
  @ApiResponse({
    status: 202,
    description: 'Enrichment process successfully started.',
  })
  @ApiResponse({ status: 404, description: 'Wallet not found.' })
  @ApiResponse({ status: 500, description: 'Internal server error.' })
  @UsePipes(new ValidationPipe({ transform: true }))
  async enrichAllTokensForWallet(
    @Param('walletAddress') walletAddress: string,
    @Req() req: Request & { user?: any },
  ): Promise<{ message: string }> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User could not be identified.');
    }


    // Don't await this. Let it run in the background.
    this.enrichTokensInBackground(walletAddress, userId);

    return { message: `Enrichment of tokens has been started in the background.` };
  }

  private async enrichTokensInBackground(walletAddress: string, userId: string): Promise<void> {
    try {
      const tokenAddresses = await this.tokenPerformanceService.getAllTokenAddressesForWallet(walletAddress);
            
      this.tokenInfoService.triggerTokenInfoEnrichment(tokenAddresses, userId);
    } catch (error) {
      this.logger.error(`Background enrichment process for wallet ${walletAddress} failed:`, error);
    }
  }
} 