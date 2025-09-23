import { Injectable, Logger } from '@nestjs/common';
import { DexscreenerService as CoreDexscreenerService } from '../../core/services/dexscreener-service';
import { DatabaseService } from '../services/database.service';
import { HttpService } from '@nestjs/axios';

@Injectable()
export class DexscreenerService {
  private readonly logger = new Logger(DexscreenerService.name);
  private coreDexscreenerService: CoreDexscreenerService;

  constructor(
    private databaseService: DatabaseService,
    private httpService: HttpService,
  ) {
    this.coreDexscreenerService = new CoreDexscreenerService(this.databaseService, this.httpService);
    this.logger.log('CoreDexscreenerService instantiated within NestJS DexscreenerService wrapper.');
  }

  async fetchAndSaveTokenInfo(tokenAddresses: string[]): Promise<void> {
    this.logger.debug(`[NestWrapper] Passing ${tokenAddresses.length} tokens to core service for fetching.`);
    if (tokenAddresses.length === 0) {
      return;
    }
    // Await the core service to ensure completion.
    await this.coreDexscreenerService.fetchAndSaveTokenInfo(tokenAddresses);
    // Sparkline appends centralized in SparklineService via TokenInfoService
  }

  async getTokenPrices(tokenAddresses: string[]): Promise<Map<string, number>> {
    this.logger.debug(`[NestWrapper] Passing ${tokenAddresses.length} tokens to core service for price fetching.`);
    if (tokenAddresses.length === 0) {
      return new Map();
    }
    return this.coreDexscreenerService.getTokenPrices(tokenAddresses);
  }

  async getSolPrice(): Promise<number> {
    this.logger.debug('[NestWrapper] Fetching SOL price from DexScreener');
    return this.coreDexscreenerService.getSolPrice();
  }
} 