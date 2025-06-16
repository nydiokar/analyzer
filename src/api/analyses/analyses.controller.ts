import { Controller, Post, Param, Logger, InternalServerErrorException, NotFoundException, UseGuards, ServiceUnavailableException, Body, HttpCode } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody, ApiProperty } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { PnlAnalysisService } from '../pnl_analysis/pnl-analysis.service';
import { BehaviorService } from '../wallets/behavior/behavior.service';
import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { Wallet } from '@prisma/client';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard';
import { SolanaAddressPipe } from '../pipes/solana-address.pipe';
import { SimilarityApiService } from './similarity/similarity.service';
import { SimilarityAnalysisRequestDto } from './similarity/similarity-analysis.dto';
import { WalletStatusRequestDto } from './dto/wallet-status.dto';

interface WalletStatus {
  walletAddress: string;
  exists: boolean;
}

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
  @ApiResponse({ status: 200, description: 'Returns a list of wallet statuses.'})
  async getWalletsStatus(
    @Body() walletStatusRequestDto: WalletStatusRequestDto
  ): Promise<{ statuses: WalletStatus[] }> {
    this.logger.log(`Received request to check status for ${walletStatusRequestDto.walletAddresses.length} wallets.`);
    return this.databaseService.getWalletsStatus(walletStatusRequestDto.walletAddresses);
  }

  @Post('/wallets/:walletAddress/trigger-analysis')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  @ApiOperation({ summary: 'Triggers a full analysis for a specific wallet' })
  @ApiParam({ name: 'walletAddress', description: 'The Solana wallet address', type: String })
  @ApiResponse({
    status: 200,
    description: 'Analysis triggered successfully and is running in the background.',
  })
  @ApiResponse({ status: 503, description: 'An analysis is already in progress.' })
  @ApiResponse({ status: 500, description: 'An error occurred during the process.' })
  @ApiResponse({ status: 404, description: 'Wallet could not be found after sync, or a dependent service failed to locate it.' })
  async triggerAnalysis(
    @Param('walletAddress', SolanaAddressPipe) walletAddress: string,
  ): Promise<{ message: string; walletAddress: string }> {
    this.logger.log(`Received request to trigger analysis for wallet: ${walletAddress}`);

    if (this.runningAnalyses.has(walletAddress)) {
      this.logger.warn(`An analysis for ${walletAddress} is already in progress. Request rejected.`);
      throw new ServiceUnavailableException(`An analysis for wallet ${walletAddress} is already in progress. Please try again later.`);
    }

    // Run analysis in the background
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

        const currentWallet: Wallet | null = await this.databaseService.getWallet(walletAddress);
        if (!currentWallet) {
          this.logger.error(`Wallet ${walletAddress} not found after sync. Aborting analysis.`);
          throw new NotFoundException(`Wallet ${walletAddress} could not be found or created during the sync process.`);
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

    const message = `Analysis for wallet ${walletAddress} has been triggered successfully and is running in the background.`;
    this.logger.log(message);
    return { message, walletAddress };
  }
} 