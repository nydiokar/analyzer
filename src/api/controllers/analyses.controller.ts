import { Controller, Post, Logger, Body, HttpCode, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { DatabaseService } from '../services/database.service';
import { SimilarityAnalysisRequestDto } from '../shared/dto/similarity-analysis.dto';
import { WalletStatusRequestDto, WalletStatusResponseDto } from '../shared/dto/wallet-status.dto';
import { DashboardAnalysisRequestDto, DashboardAnalysisResponseDto, DashboardAnalysisScope } from '../shared/dto/dashboard-analysis.dto';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';
import { SimilarityOperationsQueue } from '../../queues/queues/similarity-operations.queue';
import { EnrichmentOperationsQueue } from '../../queues/queues/enrichment-operations.queue';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import { ComprehensiveSimilarityFlowData, EnrichTokenBalancesJobData, DashboardWalletAnalysisJobData, AnalyzeHolderProfilesJobData } from '../../queues/jobs/types';
import { RedisLockService } from '../../queues/services/redis-lock.service';
import { EnrichmentStrategyService } from '../services/enrichment-strategy.service';
import { JobPriority } from '../../queues/config/queue.config';
import { DASHBOARD_ANALYSIS_SCOPE_DEFAULTS, DASHBOARD_JOB_CONFIG } from '../../config/constants';

@ApiTags('Analyses')
@Controller('/analyses')
export class AnalysesController {
  private readonly logger = new Logger(AnalysesController.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly enrichmentOperationsQueue: EnrichmentOperationsQueue,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
    private readonly enrichmentStrategyService: EnrichmentStrategyService,
    private readonly redisLockService: RedisLockService,
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
    description: 'Queues a scoped wallet analysis job for dashboard display. Returns job ID (if queued) and follow-up intent for monitoring.'
  })
  @ApiResponse({ 
    status: 202, 
    description: 'Dashboard analysis job queued or skipped due to freshness.',
    type: DashboardAnalysisResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid wallet address or request parameters' })
  @ApiResponse({ status: 503, description: 'Analysis already in progress for this wallet' })
  @HttpCode(202)
  async queueDashboardWalletAnalysis(
    @Body() dto: DashboardAnalysisRequestDto,
  ): Promise<DashboardAnalysisResponseDto> {
    const scope = dto.analysisScope ?? 'deep';
    const triggerSource = dto.triggerSource ?? 'manual';
    this.logger.log(
      `Received dashboard analysis request for wallet ${dto.walletAddress} [scope=${scope}, trigger=${triggerSource}]`,
    );

    if (!isValidSolanaAddress(dto.walletAddress)) {
      throw new BadRequestException(`Invalid Solana address: ${dto.walletAddress}`);
    }

    const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[scope];
    if (!scopeDefaults) {
      throw new BadRequestException(`Unsupported analysis scope: ${scope}`);
    }

    const historyWindowDays =
      scope === 'deep'
        ? undefined
        : dto.historyWindowDays ?? scopeDefaults.historyWindowDays ?? undefined;
    const targetSignatureCount =
      scope === 'deep'
        ? dto.targetSignatureCount ?? undefined
        : dto.targetSignatureCount ?? scopeDefaults.targetSignatureCount ?? undefined;

    const queueWorkingAfter =
      scope === 'flash' ? (dto.queueWorkingAfter ?? true) : false;
    const queueDeepAfter =
      scope === 'flash'
        ? (dto.queueDeepAfter ?? false)
        : scope === 'working'
          ? (dto.queueDeepAfter ?? true)
          : false;

    try {
      const freshnessMinutes = scopeDefaults.freshnessMinutes ?? 0;
      let skipReason: string | undefined;
      let skipped = false;

      if (!dto.forceRefresh && freshnessMinutes > 0) {
        const latestRun = await this.databaseService.getLatestDashboardAnalysisRun(dto.walletAddress, scope);
        if (latestRun) {
          const runTs = new Date(latestRun.runTimestamp).getTime();
          const ageMinutes = (Date.now() - runTs) / 60000;
          if (ageMinutes < freshnessMinutes) {
            skipped = true;
            skipReason = `fresh-within-${freshnessMinutes}m`;
          }
        }
      }

      const requestId = `dashboard-${scope}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      if (skipped) {
        this.logger.log(
          `Skipping dashboard analysis for ${dto.walletAddress} [scope=${scope}] due to ${skipReason}`,
        );
        return {
          jobId: null,
          requestId,
          status: 'queued',
          queueName: 'analysis-operations',
          analysisScope: scope,
          estimatedProcessingTime: '0 minutes',
          monitoringUrl: '',
          skipped: true,
          skipReason,
          queuedFollowUpScopes: [],
        };
      }

      const queue = this.analysisOperationsQueue.getQueue();
      const existingJobs = await queue.getJobs(['active', 'waiting', 'delayed']);
      const matchingJob = existingJobs.find((job) => {
        const jobData = job?.data as DashboardWalletAnalysisJobData | undefined;
        if (!jobData) {
          return false;
        }
        const jobScope = jobData.analysisScope ?? 'deep';
        return jobData.walletAddress === dto.walletAddress && jobScope === scope;
      });

      if (matchingJob) {
        const jobData = matchingJob.data as DashboardWalletAnalysisJobData;
        const jobId = matchingJob.id ?? undefined;
        const isActive = await matchingJob.isActive();
        const existingStatus: 'queued' | 'running' = isActive ? 'running' : 'queued';
        const existingRequestId = jobData.requestId ?? requestId;
        this.logger.log(`Dashboard analysis already ${existingStatus} for ${dto.walletAddress} [scope=${scope}] via job ${jobId ?? existingRequestId}`);
        return {
          jobId: jobId ?? null,
          requestId: existingRequestId,
          status: existingStatus,
          queueName: 'analysis-operations',
          analysisScope: scope,
          estimatedProcessingTime: existingStatus === 'running' ? 'in-progress' : 'waiting in queue',
          monitoringUrl: jobId ? `/jobs/${jobId}` : '',
          queuedFollowUpScopes: [],
          alreadyRunning: existingStatus === 'running',
        };
      }

      const lockKey = RedisLockService.createWalletLockKey(dto.walletAddress, 'dashboard-analysis');
      const existingLockJobId = await this.redisLockService.getLockValue(lockKey);
      if (existingLockJobId) {
        this.logger.log(`Dashboard analysis already in progress for ${dto.walletAddress} [scope=${scope}] via job ${existingLockJobId}`);
        return {
          jobId: existingLockJobId,
          requestId,
          status: 'running',
          queueName: 'analysis-operations',
          analysisScope: scope,
          estimatedProcessingTime: 'in-progress',
          monitoringUrl: `/jobs/${existingLockJobId}`,
          queuedFollowUpScopes: [],
          alreadyRunning: true,
        };
      }

      const walletStatuses = await this.databaseService.getWalletsStatus([dto.walletAddress]);
      const walletStatus = walletStatuses.statuses[0];
      const needsSync =
        walletStatus.status === 'STALE' ||
        walletStatus.status === 'MISSING' ||
        dto.forceRefresh;

      const priority =
        scope === 'flash'
          ? JobPriority.CRITICAL
          : scope === 'working'
            ? JobPriority.HIGH
            : JobPriority.NORMAL;

      const timeoutMinutes =
        dto.timeoutMinutes ??
        scopeDefaults.timeoutMinutes ??
        DASHBOARD_JOB_CONFIG.DEFAULT_TIMEOUT_MINUTES;

      const jobData: DashboardWalletAnalysisJobData = {
        walletAddress: dto.walletAddress,
        requestId,
        analysisScope: scope,
        triggerSource,
        historyWindowDays,
        targetSignatureCount,
        forceRefresh: dto.forceRefresh ?? false,
        enrichMetadata: scope === 'deep' ? dto.enrichMetadata !== false : false,
        queueWorkingAfter,
        queueDeepAfter,
        failureThreshold: 0.8,
        timeoutMinutes,
      };

      const job = await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
        priority,
        delay: 0,
      });

      const baseEstimate = scope === 'flash' ? 2 : scope === 'working' ? 5 : 8;
      const syncEstimate = needsSync ? (scope === 'deep' ? 15 : 8) : 0;
      const estimatedMinutes = baseEstimate + syncEstimate;
      const estimatedTime =
        estimatedMinutes > 60
          ? `${Math.round(estimatedMinutes / 60)} hour(s)`
          : `${estimatedMinutes} minute(s)`;

      const queuedFollowUpScopes: DashboardAnalysisScope[] = [];
      if (queueWorkingAfter) {
        queuedFollowUpScopes.push('working');
      }
      if (queueDeepAfter) {
        queuedFollowUpScopes.push('deep');
      }

      this.logger.log(
        `Queued dashboard analysis job ${job.id} for wallet ${dto.walletAddress} [scope=${scope}, followUps=${queuedFollowUpScopes.join(',') || 'none'}]`,
      );

      return {
        jobId: job.id!,
        requestId,
        status: 'queued',
        queueName: 'analysis-operations',
        analysisScope: scope,
        estimatedProcessingTime: estimatedTime,
        monitoringUrl: `/jobs/${job.id}`,
        queuedFollowUpScopes,
      };
    } catch (error) {
      this.logger.error(`Failed to queue dashboard analysis:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to queue dashboard analysis job');
    }
  }

  @Post('/holder-profiles')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({
    summary: 'Queue holder profiles analysis job',
    description: 'Analyzes holding behavior for top holders of a token. Returns job ID for monitoring via websockets.'
  })
  @ApiResponse({
    status: 202,
    description: 'Holder profiles analysis job queued successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Unique job identifier for tracking' },
        requestId: { type: 'string', description: 'Request identifier for this analysis' },
        status: { type: 'string', enum: ['queued'], description: 'Initial job status' },
        queueName: { type: 'string', example: 'analysis-operations' },
        tokenMint: { type: 'string', description: 'Token mint address' },
        topN: { type: 'number', description: 'Number of top holders to analyze' },
        estimatedProcessingTime: { type: 'string', description: 'Estimated time to complete' },
        monitoringUrl: { type: 'string', description: 'URL to monitor job status' }
      }
    }
  })
  @ApiResponse({ status: 400, description: 'Invalid token mint address or parameters' })
  @HttpCode(202)
  async queueHolderProfilesAnalysis(
    @Body() body: { tokenMint: string; topN?: number },
  ): Promise<{
    jobId: string;
    requestId: string;
    status: string;
    queueName: string;
    tokenMint: string;
    topN: number;
    estimatedProcessingTime: string;
    monitoringUrl: string;
  }> {
    const topN = body.topN || 10;
    this.logger.log(`Received holder profiles analysis request for token ${body.tokenMint} [topN=${topN}]`);

    if (!body.tokenMint || !isValidSolanaAddress(body.tokenMint)) {
      throw new BadRequestException(`Invalid token mint address: ${body.tokenMint}`);
    }

    if (topN < 1 || topN > 50) {
      throw new BadRequestException('topN must be between 1 and 50');
    }

    try {
      // Generate request ID
      const requestId = `holder-profiles-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Prepare job data
      const jobData: AnalyzeHolderProfilesJobData = {
        mode: 'token',
        tokenMint: body.tokenMint,
        topN,
        requestId,
      };

      // Add job to analysis operations queue
      const job = await this.analysisOperationsQueue.addHolderProfilesJob(jobData, {
        priority: 5,
        delay: 0,
      });

      // Calculate estimated processing time (roughly 1-2 seconds per wallet)
      const estimatedSeconds = topN * 1.5;
      const estimatedTime = estimatedSeconds > 60
        ? `${Math.round(estimatedSeconds / 60)} minute(s)`
        : `${Math.round(estimatedSeconds)} seconds`;

      this.logger.log(`Queued holder profiles analysis job ${job.id} for token ${body.tokenMint} with ${topN} holders`);

      return {
        jobId: job.id!,
        requestId,
        status: 'queued',
        queueName: 'analysis-operations',
        tokenMint: body.tokenMint,
        topN,
        estimatedProcessingTime: estimatedTime,
        monitoringUrl: `/jobs/${job.id}`,
      };
    } catch (error) {
      this.logger.error(`Failed to queue holder profiles analysis:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to queue holder profiles analysis job');
    }
  }

  @Post('/holder-profiles/wallet')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({
    summary: 'Analyze holder profile for a single wallet',
    description: 'Queues a job that computes the holding-risk profile for a specific wallet address.',
  })
  @ApiResponse({ status: 202, description: 'Wallet holder profile job queued successfully' })
  @ApiResponse({ status: 400, description: 'Invalid wallet address' })
  @HttpCode(202)
  async queueWalletHolderProfile(
    @Body() body: { walletAddress: string },
  ): Promise<{
    jobId: string;
    requestId: string;
    status: string;
    queueName: string;
    walletAddress: string;
    monitoringUrl: string;
  }> {
    if (!body.walletAddress || !isValidSolanaAddress(body.walletAddress)) {
      throw new BadRequestException(`Invalid wallet address: ${body.walletAddress}`);
    }

    try {
      const requestId = `holder-profile-wallet-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      const jobData: AnalyzeHolderProfilesJobData = {
        mode: 'wallet',
        walletAddress: body.walletAddress,
        requestId,
      };

      const job = await this.analysisOperationsQueue.addHolderProfilesJob(jobData, {
        priority: 5,
        delay: 0,
      });

      return {
        jobId: job.id!,
        requestId,
        status: 'queued',
        queueName: 'analysis-operations',
        walletAddress: body.walletAddress,
        monitoringUrl: `/jobs/${job.id}`,
      };
    } catch (error) {
      this.logger.error(`Failed to queue wallet holder profile analysis:`, error);
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to queue wallet holder profile job');
    }
  }
}
