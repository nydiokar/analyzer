import { Controller, Post, Param, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { PnlAnalysisService } from '../pnl_analysis/pnl-analysis.service';
import { BehaviorService } from '../wallets/behavior/behavior.service';
import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { Wallet } from '@prisma/client';

@ApiTags('Analyses')
@Controller('/analyses')
export class AnalysesController {
  private readonly logger = new Logger(AnalysesController.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly heliusSyncService: HeliusSyncService,
    private readonly pnlAnalysisService: PnlAnalysisService,
    private readonly behaviorService: BehaviorService,
  ) {}

  @Post('wallets/:walletAddress/trigger-analysis')
  @ApiOperation({
    summary: 'Trigger synchronization and analysis for a wallet.',
    description: 'Synchronously fetches all transactions for a new wallet or updates an existing one, then performs a full PNL and Behavior analysis. The results are saved to the database and can be retrieved via other endpoints.',
  })
  @ApiParam({ name: 'walletAddress', description: 'The public key of the wallet to analyze.' })
  @ApiResponse({ status: 201, description: 'Wallet synchronization and analysis completed successfully.' })
  @ApiResponse({ status: 500, description: 'An error occurred during the process.' })
  @ApiResponse({ status: 404, description: 'Wallet could not be found after sync, or a dependent service failed to locate it.' })
  async triggerAnalysis(
    @Param('walletAddress') walletAddress: string,
  ): Promise<{ message: string; walletAddress: string }> {
    this.logger.log(`Received request to trigger analysis for wallet: ${walletAddress}`);

    try {
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
        this.logger.error(`CRITICAL: Wallet ${walletAddress} not found in DB after sync service execution.`);
        throw new NotFoundException(`Wallet ${walletAddress} could not be found or provisioned after sync operation.`);
      }

      this.logger.log(`Starting PNL analysis for wallet: ${currentWallet.address}.`);
      await this.pnlAnalysisService.analyzeWalletPnl(currentWallet.address, undefined, undefined);
      this.logger.log(`PNL analysis completed for wallet: ${currentWallet.address}.`);

      this.logger.log(`Starting Behavior analysis for wallet: ${currentWallet.address}.`);
      const behaviorConfig = this.behaviorService.getDefaultBehaviorAnalysisConfig();
      await this.behaviorService.getWalletBehavior(currentWallet.address, behaviorConfig, undefined);
      this.logger.log(`Behavior analysis completed for wallet: ${currentWallet.address}.`);

      const message = isNewWalletFlow
        ? 'New wallet onboarded: Sync and full analysis completed successfully.'
        : 'Existing wallet: Sync and full re-analysis completed successfully.';

      this.logger.log(`${message} Wallet: ${walletAddress}`);
      return { message, walletAddress };

    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException || error instanceof NotFoundException) {
        throw error;
      }
      let errorMessage = 'An unknown error occurred during the analysis trigger process.';
      let errorStack = undefined;
      if (error instanceof Error) {
        errorMessage = error.message;
        errorStack = error.stack;
      }
      this.logger.error(`Unexpected error during analysis trigger for ${walletAddress}: ${errorMessage}`, errorStack, String(error));
      throw new InternalServerErrorException(`Analysis trigger failed for wallet ${walletAddress}: ${errorMessage}`);
    }
  }
} 