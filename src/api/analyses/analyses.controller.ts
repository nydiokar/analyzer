import { Controller, Post, Logger, UseGuards, ServiceUnavailableException, Body, HttpCode, BadRequestException, NotFoundException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { PnlAnalysisService } from '../pnl_analysis/pnl-analysis.service';
import { BehaviorService } from '../wallets/behavior/behavior.service';
import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { Wallet } from '@prisma/client';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard';
import { SimilarityApiService } from './similarity/similarity.service';
import { SimilarityAnalysisRequestDto } from './similarity/similarity-analysis.dto';
import { WalletStatusRequestDto, WalletStatusResponseDto } from './dto/wallet-status.dto';
import { TriggerAnalysisDto } from './dto/trigger-analysis.dto';
import { isValidSolanaAddress } from '../pipes/solana-address.pipe';

@ApiTags('Analyses')
@Controller('/analyses')
@UseGuards(ApiKeyAuthGuard)
export class AnalysesController {
  private readonly logger = new Logger(AnalysesController.name);
  private runningAnalyses = new Set<string>();

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly heliusSyncService: HeliusSyncService,
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly behaviorService: BehaviorService,
    private readonly similarityApiService: SimilarityApiService,
  ) {}

  @Post('/similarity')
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Runs a similarity analysis on a given set of wallets.' })
  @ApiBody({ type: SimilarityAnalysisRequestDto })
  @ApiResponse({ status: 200, description: 'Similarity analysis completed successfully.'})
  @ApiResponse({ status: 400, description: 'Invalid input, e.g., fewer than 2 wallets provided.' })
  @ApiResponse({ status: 500, description: 'An internal error occurred during analysis.' })
  async runSimilarityAnalysis(
    @Body() dto: SimilarityAnalysisRequestDto,
  ): Promise<any> {
    this.logger.log(`Received request to run similarity analysis for ${dto.walletAddresses.length} wallets.`);
    return this.similarityApiService.runAnalysis(dto);
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
          this.logger.log(`Lock acquired for analysis of wallet: ${walletAddress}.`);
          
          const initialWalletState: Wallet | null = await this.databaseService.getWallet(walletAddress);
          const isNewWalletFlow = !initialWalletState;

          if (isNewWalletFlow) {
            this.logger.log(`Wallet ${walletAddress} appears new or not yet in DB. Proceeding with comprehensive sync and analysis.`);
          } else {
            this.logger.log(`Wallet ${walletAddress} exists. Proceeding with update sync and full re-analysis.`);
          }

          const syncOptions: SyncOptions = {
            limit: 100,
            fetchAll: true,
            skipApi: false,
            fetchOlder: true,
            maxSignatures: 2000,
            smartFetch: true,
          };

          this.logger.log(`Calling HeliusSyncService.syncWalletData for ${walletAddress} with options: ${JSON.stringify(syncOptions)}`);
          await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
          this.logger.log(`Helius sync process completed for ${walletAddress}.`);

          const currentWallet: Wallet | null = await this.databaseService.ensureWalletExists(walletAddress);
          if (!currentWallet) {
            this.logger.error(`Failed to find or create wallet ${walletAddress}. Aborting analysis for this wallet.`);
            return;
          }

          this.logger.log('Wallet data synced, proceeding to PNL and Behavior analysis.');
          await this.pnlAnalysisService.analyzeWalletPnl(walletAddress);
          this.logger.log(`PNL analysis completed for ${walletAddress}.`);

          this.logger.log(`Starting Behavior analysis for wallet: ${walletAddress}.`);
          const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
          await this.behaviorService.getWalletBehavior(walletAddress, behaviorConfig);
          this.logger.log(`Behavior analysis completed for ${walletAddress}.`);

        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          const errorStack = error instanceof Error ? error.stack : undefined;
          this.logger.error(`Unexpected error during async analysis for ${walletAddress}: ${errorMessage}`, errorStack, String(error));
        } finally {
          this.runningAnalyses.delete(walletAddress);
          this.logger.log(`Lock released after analysis of wallet: ${walletAddress}.`);
        }
      })();
    });

    const message = `Analysis for ${analysesToRun.length} wallet(s) has been triggered successfully. ${skippedAnalyses.length} were skipped as they were already in progress.`;
    this.logger.log(message);
    return { message, triggeredAnalyses: analysesToRun, skippedAnalyses };
  }
} 