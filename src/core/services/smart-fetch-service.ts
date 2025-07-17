import { Injectable, Logger } from '@nestjs/common';
import { createLogger } from '../utils/logger';
import { WalletClassificationService, SmartFetchRecommendation } from './wallet-classification.service';

const logger = createLogger('SmartFetchService');

export { SmartFetchRecommendation };

/**
 * Service for smart transaction fetching to prevent constant 10k+ fetches
 * BOUNDED: Simple wrapper around WalletClassificationService
 * Can work both with NestJS DI and manual instantiation
 */
@Injectable()
export class SmartFetchService {
  private classificationService: WalletClassificationService;

  constructor(classificationService?: WalletClassificationService) {
    // Support both DI and manual instantiation
    this.classificationService = classificationService || new WalletClassificationService();
  }

  /**
   * Get fetch recommendation for a wallet
   * BOUNDED: Uses classification service, no complex logic here
   */
  async getSmartFetchRecommendation(walletAddress: string): Promise<SmartFetchRecommendation> {
    return this.classificationService.getSmartFetchRecommendation(walletAddress);
  }

  /**
   * Auto-classify wallet based on smart fetch recommendation
   * BOUNDED: Only 3 states, nothing more
   * Returns final classification (existing or auto-assigned)
   */
  async getOrAutoClassifyWallet(walletAddress: string): Promise<string> {
    const currentClassification = await this.classificationService.getWalletClassification(walletAddress);
    
    // If already properly classified, return it
    if (currentClassification && currentClassification !== 'unknown') {
      return currentClassification;
    }
    
    // Auto-classify based on smart fetch recommendation
    const recommendation = await this.getSmartFetchRecommendation(walletAddress);
    
    if (recommendation.shouldLimitFetch) {
      await this.classificationService.updateWalletClassification(
        walletAddress,
        'high_frequency',
        `Auto-classified based on: ${recommendation.reason}`
      );
      logger.info(`🤖 Auto-classified ${walletAddress} as 'high_frequency': ${recommendation.reason}`);
      return 'high_frequency';
    } else {
      await this.classificationService.updateWalletClassification(
        walletAddress,
        'normal',
        `Auto-classified based on: ${recommendation.reason}`
      );
      logger.info(`✅ Auto-classified ${walletAddress} as 'normal': ${recommendation.reason}`);
      return 'normal';
    }
  }

  /**
   * @deprecated Use getOrAutoClassifyWallet() instead
   * Update wallet to high frequency classification if recommended
   */
  async updateWalletClassificationIfNeeded(walletAddress: string): Promise<void> {
    await this.getOrAutoClassifyWallet(walletAddress);
  }
} 