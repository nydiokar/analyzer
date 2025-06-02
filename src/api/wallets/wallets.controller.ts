import { Controller, Post, Param, Logger, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { DatabaseService } from '../database/database.service';
import { PnlAnalysisService } from '../pnl_analysis/pnl-analysis.service';
import { HeliusSyncService, SyncOptions } from '../../core/services/helius-sync-service';
import { Wallet } from '@prisma/client';

@ApiTags('Wallets')
@Controller('api/v1/wallets')
export class WalletsAnalysisController {
  private readonly logger = new Logger(WalletsAnalysisController.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly heliusSyncService: HeliusSyncService,
    private readonly pnlAnalysisService: PnlAnalysisService
  ) {}

  @Post(':walletAddress/analyze')
  @ApiOperation({
    summary: 'Trigger data synchronization and PNL analysis for a wallet.',
    description: 'Synchronously fetches/updates transaction data for the specified wallet and then performs PNL and advanced stats calculations. The Wallet model\'s analyzedTimestampStart and analyzedTimestampEnd fields are updated upon successful analysis.',
  })
  @ApiParam({ name: 'walletAddress', description: 'The public key of the wallet to analyze.', type: String })
  @ApiResponse({ status: 201, description: 'Wallet synchronization and PNL analysis completed successfully.' })
  @ApiResponse({ status: 404, description: 'Wallet not found after sync or initial check.' })
  @ApiResponse({ status: 500, description: 'An error occurred during the process.' })
  async analyzeWallet(
    @Param('walletAddress') walletAddress: string,
  ): Promise<{ message: string; walletAddress: string; analyzedTimestampStart?: number; analyzedTimestampEnd?: number }> {
    this.logger.log(`Received request to analyze wallet: ${walletAddress}`);

    try {
      const initialWalletState: Wallet | null = await this.databaseService.getWallet(walletAddress);
      const isNewWalletLogMessage = !initialWalletState ? "(new wallet flow)" : "(existing wallet flow)";
      this.logger.log(`Wallet ${walletAddress} ${isNewWalletLogMessage}. Starting sync and PNL analysis.`);

      const syncOptions: SyncOptions = {
        limit: 50,
        fetchAll: true,
        skipApi: false,
        fetchOlder: true,
        maxSignatures: 20000,
        smartFetch: true,
      };

      this.logger.log(`Calling HeliusSyncService.syncWalletData for ${walletAddress} with options: ${JSON.stringify(syncOptions)}`);
      await this.heliusSyncService.syncWalletData(walletAddress, syncOptions);
      this.logger.log(`Helius sync process completed for ${walletAddress}.`);

      const walletAfterSync: Wallet | null = await this.databaseService.getWallet(walletAddress);
      if (!walletAfterSync) {
        this.logger.error(`CRITICAL: Wallet ${walletAddress} not found in DB after sync service execution.`);
        throw new NotFoundException(`Wallet ${walletAddress} could not be found or provisioned after sync operation.`);
      }

      this.logger.log(`Starting PNL analysis for wallet: ${walletAfterSync.address}.`);
      const pnlAnalysisResult = await this.pnlAnalysisService.analyzeWalletPnl(walletAfterSync.address, undefined, { isViewOnly: false });
      this.logger.log(`PNL analysis completed for wallet: ${walletAfterSync.address}.`);

      if (!pnlAnalysisResult) {
        this.logger.warn(`PNL analysis for ${walletAddress} returned no result, but sync was successful. This might indicate no relevant transactions for PNL.`);
      }

      const updatedWallet = await this.databaseService.getWallet(walletAddress);

      const message = `Wallet ${walletAddress} analyzed successfully. Sync and PNL analysis complete.`;
      this.logger.log(`${message} Timestamps: Start=${updatedWallet?.analyzedTimestampStart}, End=${updatedWallet?.analyzedTimestampEnd}`);
      return {
        message,
        walletAddress,
        analyzedTimestampStart: updatedWallet?.analyzedTimestampStart ?? undefined,
        analyzedTimestampEnd: updatedWallet?.analyzedTimestampEnd ?? undefined,
      };

    } catch (error: unknown) {
      if (error instanceof InternalServerErrorException || error instanceof NotFoundException) {
        throw error;
      }
      let errorMessage = 'An unknown error occurred during the wallet analysis.';
      let errorStack = undefined;
      if (error instanceof Error) {
        errorMessage = error.message;
        errorStack = error.stack;
      }
      this.logger.error(`Error during analysis for wallet ${walletAddress}: ${errorMessage}`, errorStack, String(error));
      throw new InternalServerErrorException(`Analysis failed for wallet ${walletAddress}: ${errorMessage}`);
    }
  }
} 