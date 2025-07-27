import { Controller, Post, Logger, UseGuards, ServiceUnavailableException, Body, HttpCode, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { DatabaseService } from '../services/database.service';
import { PnlAnalysisService } from '../services/pnl-analysis.service';
import { BehaviorService } from '../services/behavior.service';
import { SmartFetchService } from '../../core/services/smart-fetch-service';

import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { Wallet } from '@prisma/client';
import { SimilarityAnalysisRequestDto } from '../shared/dto/similarity-analysis.dto';
import { WalletStatusRequestDto, WalletStatusResponseDto } from '../shared/dto/wallet-status.dto';
import { TriggerAnalysisDto } from '../shared/dto/trigger-analysis.dto';
import { DashboardAnalysisRequestDto, DashboardAnalysisResponseDto } from '../shared/dto/dashboard-analysis.dto';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';
import { SimilarityOperationsQueue } from '../../queues/queues/similarity-operations.queue';
import { EnrichmentOperationsQueue } from '../../queues/queues/enrichment-operations.queue';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import { ComprehensiveSimilarityFlowData, EnrichTokenBalancesJobData, DashboardWalletAnalysisJobData } from '../../queues/jobs/types';
import { EnrichmentStrategyService } from '../services/enrichment-strategy.service';
import { ANALYSIS_EXECUTION_CONFIG, DASHBOARD_JOB_CONFIG } from '../../config/constants';
import { JobPriority } from '../../queues/config/queue.config';

@ApiTags('Analyses')
@Controller('/analyses')
export class AnalysesController {
  private readonly logger = new Logger(AnalysesController.name);
  private runningAnalyses = new Set<string>();

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly heliusSyncService: HeliusSyncService,
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly behaviorService: BehaviorService,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
    private readonly enrichmentStrategyService: EnrichmentStrategyService,
    private readonly smartFetchService: SmartFetchService,
  ) {}

  @Post('/similarity/enrich-balances')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ 
    summary: 'Queue wallet balance enrichment job',
    description: 'Queues a balance enrichment job using the sophisticated enrichment system. Returns job ID for monitoring via the Jobs API.'
  })
  @ApiResponse({ 
    status: 202, 
    description: 'Enrichment job queued successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Unique job identifier for tracking' },
        requestId: { type: 'string', description: 'Request identifier for this enrichment' },
        status: { type: 'string', enum: ['queued'], description: 'Initial job status' },
        queueName: { type: 'string', example: 'enrichment-operations' },
        walletCount: { type: 'number', description: 'Number of wallets to enrich' },
        tokenCount: { type: 'number', description: 'Total number of tokens to enrich' },
        monitoringUrl: { type: 'string', description: 'URL to monitor job status' }
      }
    }
  })
  @HttpCode(202)
  async enrichWalletBalances(
    @Body() body: { walletBalances: Record<string, any> },
  ): Promise<{
    jobId: string;
    requestId: string;
    status: string;
    queueName: string;
    walletCount: number;
    tokenCount: number;
    monitoringUrl: string;
  }> {
    this.logger.log(`Received request to queue balance enrichment for ${Object.keys(body.walletBalances || {}).length} wallets.`);

    if (!body.walletBalances || Object.keys(body.walletBalances).length === 0) {
      throw new BadRequestException('Invalid request: walletBalances object is missing or empty.');
    }

    try {
      // Generate request ID
      const requestId = `enrichment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Count total tokens to enrich
      const totalTokens = Object.values(body.walletBalances).reduce((count, wallet: any) => {
        // Add a check to ensure wallet and wallet.tokenBalances are valid
        if (wallet && Array.isArray(wallet.tokenBalances)) {
          return count + wallet.tokenBalances.length;
        }
        return count;
      }, 0);

      if (totalTokens === 0) {
        throw new BadRequestException('No tokens found in the provided wallet balances to enrich.');
      }

      // Determine optimization hint based on token count using strategy service
      const optimizationHint = this.enrichmentStrategyService.determineOptimizationHint(totalTokens);
      
      this.logger.log(`Determined optimization hint '${optimizationHint}' for ${totalTokens} tokens. Strategy: ${this.enrichmentStrategyService.getStrategyDescription(optimizationHint)}`);

      // Prepare job data
      const jobData: EnrichTokenBalancesJobData = {
        walletBalances: body.walletBalances,
        requestId,
        priority: 5, // Normal priority
        optimizationHint
      };

      // Add job to enrichment operations queue
      const job = await this.enrichmentOperationsQueue.addEnrichTokenBalances(jobData, {
        priority: 5,
        delay: 0
      });

      this.logger.log(`Queued balance enrichment job ${job.id} for request ${requestId} with ${Object.keys(body.walletBalances).length} wallets and ${totalTokens} tokens`);

      return {
        jobId: job.id!,
        requestId,
        status: 'queued',
        queueName: 'enrichment-operations',
        walletCount: Object.keys(body.walletBalances).length,
        tokenCount: totalTokens,
        monitoringUrl: `/jobs/${job.id}`
      };

    } catch (error) {
      this.logger.error(`Failed to queue balance enrichment:`, error);
      throw new InternalServerErrorException('Failed to queue balance enrichment job');
    }
  }

  @Post('/similarity/queue')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ 
    summary: 'Queue a similarity analysis job',
    description: 'Adds a similarity analysis job to the BullMQ queue for background processing. Returns job ID and status for monitoring via the Jobs API.'
  })
  @ApiBody({ 
    type: SimilarityAnalysisRequestDto,
    description: 'Similarity analysis request with wallet addresses and optional configuration'
  })
  @ApiResponse({ 
    status: 202, 
    description: 'Similarity analysis job queued successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Unique job identifier for tracking' },
        requestId: { type: 'string', description: 'Request identifier for this similarity analysis' },
        status: { type: 'string', enum: ['queued'], description: 'Initial job status' },
        queueName: { type: 'string', example: 'similarity-operations' },
        walletCount: { type: 'number', description: 'Number of wallets to analyze' },
        estimatedProcessingTime: { type: 'string', description: 'Estimated processing time' },
        monitoringUrl: { type: 'string', description: 'URL to monitor job status' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid input - fewer than 2 wallets provided or invalid addresses' })
  @ApiResponse({ status: 429, description: 'Rate limit exceeded' })
  @HttpCode(202)
  async queueSimilarityAnalysis(
    @Body() dto: SimilarityAnalysisRequestDto,
  ): Promise<{
    jobId: string;
    requestId: string;
    status: string;
    queueName: string;
    walletCount: number;
    estimatedProcessingTime: string;
    monitoringUrl: string;
  }> {
    this.logger.log(`Received request to queue similarity analysis for ${dto.walletAddresses.length} wallets.`);

    // Validate input
    if (!dto.walletAddresses || dto.walletAddresses.length < 2) {
      throw new BadRequestException('At least two wallet addresses are required for similarity analysis.');
    }

    // Validate wallet addresses
    const invalidWallets = dto.walletAddresses.filter(w => !isValidSolanaAddress(w));
    if (invalidWallets.length > 0) {
      throw new BadRequestException(`Invalid Solana address(es) provided: ${invalidWallets.join(', ')}`);
    }

    try {
      // Generate request ID  
      const requestId = `similarity-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Check wallet status to determine which wallets need sync
      const walletStatuses = await this.databaseService.getWalletsStatus(dto.walletAddresses);
      const walletsNeedingSync = walletStatuses.statuses
        .filter(status => status.status === 'STALE' || status.status === 'MISSING')
        .map(status => status.walletAddress);
      
      this.logger.log(`Advanced analysis: ${walletsNeedingSync.length}/${dto.walletAddresses.length} wallets need sync: [${walletsNeedingSync.join(', ')}]`);

      // Prepare job data - delegate to existing SimilarityApiService
      const jobData: ComprehensiveSimilarityFlowData = {
        walletAddresses: dto.walletAddresses,
        requestId,
        walletsNeedingSync, // Pass specific wallets to sync (empty array = no sync needed)
        enrichMetadata: true, // Enable metadata enrichment for proper token display
        failureThreshold: 0.8, // 80% success rate required
        timeoutMinutes: walletsNeedingSync.length > 0 ? 45 : 15, // Longer timeout if sync is needed
        similarityConfig: {
          vectorType: dto.vectorType || 'capital', // Use DTO vectorType
        }
      };

      // Add job to similarity operations queue
      const job = await this.similarityOperationsQueue.addSimilarityAnalysisFlow(jobData, {
        priority: 5, // Normal priority
        delay: 0 // No delay
      });

      // Calculate estimated processing time based on wallet count
      const baseTimeMinutes = 5; // Base processing time
      const timePerWallet = 2; // Additional minutes per wallet
      const estimatedMinutes = baseTimeMinutes + (dto.walletAddresses.length * timePerWallet);
      const estimatedTime = estimatedMinutes > 60 
        ? `${Math.round(estimatedMinutes / 60)} hour(s)`
        : `${estimatedMinutes} minute(s)`;

      this.logger.log(`Queued similarity analysis job ${job.id} for request ${requestId} with ${dto.walletAddresses.length} wallets`);

      return {
        jobId: job.id!,
        requestId,
        status: 'queued',
        queueName: 'similarity-operations',
        walletCount: dto.walletAddresses.length,
        estimatedProcessingTime: estimatedTime,
        monitoringUrl: `/jobs/${job.id}`
      };

    } catch (error) {
      this.logger.error(`Failed to queue similarity analysis:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to queue similarity analysis job');
    }
  }

  @Post('/wallets/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Checks the database for the existence of multiple wallets.' })
  @ApiBody({ type: WalletStatusRequestDto })
  @ApiResponse({ status: 200, description: 'Returns a list of wallet statuses.', type: WalletStatusResponseDto })
  async getWalletsStatus(
    @Body() walletStatusRequestDto: WalletStatusRequestDto
  ): Promise<WalletStatusResponseDto> {
    this.logger.log(`Received request to check status for ${walletStatusRequestDto.walletAddresses.length} wallets.`);
    return this.databaseService.getWalletsStatus(walletStatusRequestDto.walletAddresses);
  }

  @Post('/wallets/dashboard-analysis')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ 
    summary: 'Queue dashboard wallet analysis job',
    description: 'Queues a comprehensive wallet analysis job for dashboard display. Returns job ID for monitoring via the Jobs API.'
  })
  @ApiResponse({ 
    status: 202, 
    description: 'Dashboard analysis job queued successfully',
    type: DashboardAnalysisResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid wallet address or request parameters' })
  @ApiResponse({ status: 503, description: 'Analysis already in progress for this wallet' })
  @HttpCode(202)
  async queueDashboardWalletAnalysis(
    @Body() dto: DashboardAnalysisRequestDto,
  ): Promise<DashboardAnalysisResponseDto> {
    this.logger.log(`Received request to queue dashboard analysis for wallet: ${dto.walletAddress}`);

    // Validate wallet address
    if (!isValidSolanaAddress(dto.walletAddress)) {
      throw new BadRequestException(`Invalid Solana address: ${dto.walletAddress}`);
    }

    try {
      // Generate request ID
      const requestId = `dashboard-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Check wallet status to estimate processing time
      const walletStatuses = await this.databaseService.getWalletsStatus([dto.walletAddress]);
      const needsSync = walletStatuses.statuses[0].status === 'STALE' || 
                       walletStatuses.statuses[0].status === 'MISSING' || 
                       dto.forceRefresh;

      // Prepare job data
      const jobData: DashboardWalletAnalysisJobData = {
        walletAddress: dto.walletAddress,
        requestId,
        forceRefresh: dto.forceRefresh || false,
        enrichMetadata: dto.enrichMetadata !== false, // Default to true
        failureThreshold: 0.8,
        timeoutMinutes: needsSync ? 15 : 8, // Longer timeout if sync is needed
      };

      // Add job to analysis operations queue
      const job = await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
        priority: JobPriority.CRITICAL, // High priority for user-initiated requests
        delay: 0
      });

      // Calculate estimated processing time
      const baseTimeMinutes = 3; // Base analysis time
      const syncTimeMinutes = needsSync ? 10 : 0; // Additional time if sync needed
      const estimatedMinutes = baseTimeMinutes + syncTimeMinutes;
      const estimatedTime = estimatedMinutes > 60 
        ? `${Math.round(estimatedMinutes / 60)} hour(s)`
        : `${estimatedMinutes} minute(s)`;

      this.logger.log(`Queued dashboard analysis job ${job.id} for wallet ${dto.walletAddress}`);

      return {
        jobId: job.id!,
        requestId,
        status: 'queued',
        queueName: 'analysis-operations',
        estimatedProcessingTime: estimatedTime,
        monitoringUrl: `/jobs/${job.id}`
      };

    } catch (error) {
      this.logger.error(`Failed to queue dashboard analysis:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to queue dashboard analysis job');
    }
  }

  @Post('/wallets/trigger-analysis')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ 
    summary: 'Triggers a full analysis for multiple wallets (DEPRECATED)',
    description: 'DEPRECATED: Use /analyses/wallets/dashboard-analysis for new implementations. This endpoint will be removed in a future version.'
  })
  @ApiBody({ type: TriggerAnalysisDto })
  @ApiResponse({
    status: 200,
    description: 'Analysis triggered successfully for the valid wallets.',
  })
  @ApiResponse({ status: 400, description: 'Invalid wallet addresses provided.' })
  @ApiResponse({ status: 503, description: 'An analysis is already in progress for some wallets.' })
  async triggerAnalyses(
    @Body() triggerAnalysisDto: TriggerAnalysisDto,
  ): Promise<{ message: string; triggeredAnalyses: string[]; skippedAnalyses: string[] }> {
    // Check feature flag for gradual rollout
    const useJobSystem = DASHBOARD_JOB_CONFIG.ENABLED;
    
    if (useJobSystem && triggerAnalysisDto.walletAddresses.length === 1) {
      // Redirect single wallet to new job-based endpoint
      this.logger.warn('Deprecated endpoint /analyses/wallets/trigger-analysis called. Redirecting to new job-based endpoint.');
      
      try {
        const jobResponse = await this.queueDashboardWalletAnalysis({
          walletAddress: triggerAnalysisDto.walletAddresses[0],
          forceRefresh: false,
          enrichMetadata: true
        });
        
        return {
          message: `Analysis job queued successfully. Job ID: ${jobResponse.jobId}`,
          triggeredAnalyses: [triggerAnalysisDto.walletAddresses[0]],
          skippedAnalyses: []
        };
      } catch (error) {
        this.logger.error('Failed to redirect to job-based endpoint:', error);
        // Fall back to old implementation
      }
    }
    
    // Use old synchronous processing for backward compatibility
    this.logger.warn('Using deprecated synchronous processing for /analyses/wallets/trigger-analysis');
    
    const { walletAddresses } = triggerAnalysisDto;
    this.logger.log(`Received request to trigger analysis for wallets: ${walletAddresses.join(', ')}`);

    const invalidWallets = walletAddresses.filter(w => !isValidSolanaAddress(w));
    if (invalidWallets.length > 0) {
      throw new BadRequestException(`Invalid Solana address(es) provided: ${invalidWallets.join(', ')}`);
    }

    const analysesToRun: string[] = [];
    const skippedAnalyses: string[] = [];

    for (const walletAddress of walletAddresses) {
      if (this.runningAnalyses.has(walletAddress)) {
        this.logger.warn(`An analysis for ${walletAddress} is already in progress. Request skipped for this wallet.`);
        skippedAnalyses.push(walletAddress);
      } else {
        analysesToRun.push(walletAddress);
      }
    }

    // Run analysis in the background for each wallet without waiting for all to complete
    analysesToRun.forEach(walletAddress => {
      (async () => {
        try {
          this.runningAnalyses.add(walletAddress);
          this.logger.debug(`Lock acquired for analysis of wallet: ${walletAddress}.`);
          
          const initialWalletState: Wallet | null = await this.databaseService.getWallet(walletAddress);
          const isNewWalletFlow = !initialWalletState;

          if (isNewWalletFlow) {
            this.logger.debug(`Wallet ${walletAddress} appears new or not yet in DB. Proceeding with comprehensive sync and analysis.`);
          } else {
            this.logger.debug(`Wallet ${walletAddress} exists. Proceeding with update sync and full re-analysis.`);
          }

          const syncOptions: SyncOptions = {
            limit: 100,
            fetchAll: true,
            skipApi: false,
            fetchOlder: true,
            maxSignatures: ANALYSIS_EXECUTION_CONFIG.DASHBOARD_MAX_SIGNATURES,
            smartFetch: true,
          };

          this.logger.debug(`Calling HeliusSyncService.syncWalletData for ${walletAddress} with options: ${JSON.stringify(syncOptions)}`);
          
          // Auto-classify wallet and notify if high-frequency
          try {
            const finalClassification = await this.smartFetchService.getOrAutoClassifyWallet(walletAddress);
            if (finalClassification === 'high_frequency') {
              // Send WebSocket notification about limited analysis
              const message = `High-frequency wallet detected. Analysis limited to ${syncOptions.maxSignatures} recent transactions for optimal performance.`;
              // TODO: Add WebSocket broadcast here when WebSocket service is available
              this.logger.log(`🤖 [Analysis] ${message} - Wallet: ${walletAddress}`);
            }
          } catch (error) {
            this.logger.warn(`Failed to auto-classify wallet ${walletAddress}:`, error);
          }
          
          await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
          this.logger.debug(`Helius sync process completed for ${walletAddress}.`);

          const currentWallet: Wallet | null = await this.databaseService.ensureWalletExists(walletAddress);
          if (!currentWallet) {
            this.logger.error(`Failed to find or create wallet ${walletAddress}. Aborting analysis for this wallet.`);
            return;
          }

          this.logger.debug('Wallet data synced, proceeding to PNL and Behavior analysis.');
          await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);
          this.logger.debug(`PNL analysis completed for ${walletAddress}.`);

          this.logger.debug(`Starting Behavior analysis for wallet: ${walletAddress}.`);
          const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
          const behaviorMetrics = await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig);
          this.logger.debug(`Behavior analysis completed for ${walletAddress}.`);

          // Smart fetch classification is now handled in HeliusSyncService

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error(`Unexpected error during async analysis for ${walletAddress}: ${errorMessage}`, errorStack, String(error));
        } finally {
          this.runningAnalyses.delete(walletAddress);
          this.logger.debug(`Lock released after analysis of wallet: ${walletAddress}.`);
        }
      })();
    });

    const message = `Analysis for ${analysesToRun.length} wallet(s) has been triggered successfully. ${skippedAnalyses.length} were skipped as they were already in progress.`;
    this.logger.log(message);
    return { message, triggeredAnalyses: analysesToRun, skippedAnalyses };
  }

  public isAnalysisRunning(walletAddress: string): boolean {
    return this.runningAnalyses.has(walletAddress);
  }
} 