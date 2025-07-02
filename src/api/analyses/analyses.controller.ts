import { Controller, Post, Logger, UseGuards, ServiceUnavailableException, Body, HttpCode, BadRequestException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { PnlAnalysisService } from '../pnl_analysis/pnl-analysis.service';
import { BehaviorService } from '../wallets/behavior/behavior.service';
import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { Wallet } from '@prisma/client';
import { SimilarityApiService } from './similarity/similarity.service';
import { SimilarityAnalysisRequestDto } from './similarity/similarity-analysis.dto';
import { WalletStatusRequestDto, WalletStatusResponseDto } from './dto/wallet-status.dto';
import { TriggerAnalysisDto } from './dto/trigger-analysis.dto';
import { isValidSolanaAddress } from '../pipes/solana-address.pipe';
import { SimilarityOperationsQueue } from '../../queues/queues/similarity-operations.queue';
import { SimilarityAnalysisFlowData } from '../../queues/jobs/types';
import { generateJobId } from '../../queues/utils/job-id-generator';
import { JobsService } from '../jobs/jobs.service';

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
    private readonly similarityApiService: SimilarityApiService,
    private readonly similarityOperationsQueue: SimilarityOperationsQueue,
    private readonly jobsService: JobsService,
  ) {}

  @Post('/similarity')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ 
    summary: 'Runs a similarity analysis on a given set of wallets.',
    description: 'C3 Backwards Compatibility: Internally uses job queue but maintains synchronous interface for existing clients.'
  })
  @ApiBody({ type: SimilarityAnalysisRequestDto })
  @ApiResponse({ status: 200, description: 'Similarity analysis completed successfully.'})
  @ApiResponse({ status: 400, description: 'Invalid input, e.g., fewer than 2 wallets provided.' })
  @ApiResponse({ status: 500, description: 'An internal error occurred during analysis.' })
  async runSimilarityAnalysis(
    @Body() dto: SimilarityAnalysisRequestDto,
  ): Promise<any> {
    this.logger.log(`[C3 Backwards Compatibility] Received request to run similarity analysis for ${dto.walletAddresses.length} wallets.`);
    
    try {
      // **TRUE BACKWARDS COMPATIBILITY**: Use original similarity service directly
      // This bypasses the job queue entirely for genuine pipeline comparison
      this.logger.log(`[C3] Using original SimilarityApiService (bypassing job queue)...`);
      const result = await this.similarityApiService.runAnalysis(dto);
      this.logger.log(`[C3] Original similarity service completed successfully.`);
      return result;

    } catch (error) {
      this.logger.error(`[C3] Error in backwards compatibility similarity analysis:`, error);
      
      // If it's already a known HTTP exception, re-throw it
      if (error instanceof BadRequestException || 
          error instanceof InternalServerErrorException || 
          error instanceof ServiceUnavailableException) {
        throw error;
      }

      // For unexpected errors, wrap in InternalServerErrorException
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[C3] Unexpected error: ${errorMessage}`);
      throw new InternalServerErrorException(`Similarity analysis failed: ${errorMessage}`);
    }
  }

  @Post('/similarity/enrich-balances')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @ApiOperation({ summary: 'Enriches a given set of wallet balances with price and metadata.' })
  @ApiResponse({ status: 200, description: 'Enrichment completed successfully.'})
  async enrichWalletBalances(
    @Body() body: { walletBalances: Record<string, any> }, // Define a more specific DTO for this if needed
  ): Promise<any> {
    this.logger.log(`Received request to enrich balances for ${Object.keys(body.walletBalances).length} wallets.`);
    return this.similarityApiService.enrichBalances(body.walletBalances);
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

      // Prepare job data - delegate to existing SimilarityApiService
      const jobData: SimilarityAnalysisFlowData = {
        walletAddresses: dto.walletAddresses,
        requestId,
        failureThreshold: 0.8, // 80% success rate required
        timeoutMinutes: 30, // 30 minute timeout
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

  @Post('/wallets/trigger-analysis')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @ApiOperation({ summary: 'Triggers a full analysis for multiple wallets' })
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
            maxSignatures: 200,
            smartFetch: true,
          };

          this.logger.debug(`Calling HeliusSyncService.syncWalletData for ${walletAddress} with options: ${JSON.stringify(syncOptions)}`);
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
          await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig);
          this.logger.debug(`Behavior analysis completed for ${walletAddress}.`);

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