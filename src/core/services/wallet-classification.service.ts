import { Injectable, Logger } from '@nestjs/common';
import { createLogger } from '../utils/logger';
import { PrismaClient, Wallet, MappingActivityLog } from '@prisma/client';
import { prisma } from '../../core/services/database-service';

const logger = createLogger('WalletClassificationService');

export interface SmartFetchRecommendation {
  shouldLimitFetch: boolean;
  maxSignatures: number;
  reason: string;
  cacheHours?: number;
}

export interface HighVolumeWalletStats {
  walletAddress: string;
  totalTransactions: number;
  unknownSkipped: number;
  successfullyProcessed: number;
  skipRatio: number;
  avgUnknownSkipped: number;
}

/**
 * Dedicated service for wallet classification and bot detection
 * BOUNDED: Only handles classification, not complex behavior analysis
 */
@Injectable()
export class WalletClassificationService {
  private prismaClient: PrismaClient = prisma;

  /**
   * Get mapping activity logs for analysis
   */
  async getMappingActivityLogs(
    walletAddress: string, 
    options: { limit?: number; fromDate?: Date } = {}
  ): Promise<MappingActivityLog[]> {
    const { limit = 10, fromDate } = options;
    
    try {
      const whereClause: any = { walletAddress };
      if (fromDate) {
        whereClause.timestamp = { gte: fromDate };
      }

      return await this.prismaClient.mappingActivityLog.findMany({
        where: whereClause,
        orderBy: { timestamp: 'desc' },
        take: limit,
      });
    } catch (error) {
      logger.error(`Error fetching mapping activity logs for ${walletAddress}:`, error);
      return [];
    }
  }

  /**
   * Get wallets with high unknown transaction skip rates
   */
  async getHighVolumeWallets(limit: number = 20): Promise<HighVolumeWalletStats[]> {
    try {
      const results = await this.prismaClient.mappingActivityLog.findMany({
        where: {
          unknownTxSkippedNoJito: { gt: 1000 } // High skip count
        },
        orderBy: { unknownTxSkippedNoJito: 'desc' },
        take: limit,
        select: {
          walletAddress: true,
          totalTransactionsReceived: true,
          unknownTxSkippedNoJito: true,
          transactionsSuccessfullyProcessed: true,
          timestamp: true,
        }
      });

      return results.map(log => ({
        walletAddress: log.walletAddress,
        totalTransactions: log.totalTransactionsReceived || 0,
        unknownSkipped: log.unknownTxSkippedNoJito || 0,
        successfullyProcessed: log.transactionsSuccessfullyProcessed || 0,
        skipRatio: log.totalTransactionsReceived 
          ? (log.unknownTxSkippedNoJito || 0) / log.totalTransactionsReceived 
          : 0,
        avgUnknownSkipped: log.unknownTxSkippedNoJito || 0,
      }));
    } catch (error) {
      logger.error('Error fetching high volume wallets:', error);
      return [];
    }
  }

  /**
   * Determine if wallet should have limited fetching
   * BOUNDED: Simple rules only
   */
  async getSmartFetchRecommendation(walletAddress: string): Promise<SmartFetchRecommendation> {
    try {
      // Check recent mapping activity (last 3 days)
      const recentLogs = await this.getMappingActivityLogs(walletAddress, {
        limit: 3,
        fromDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
      });

      if (recentLogs.length === 0) {
        return {
          shouldLimitFetch: false,
          maxSignatures: 10000,
          reason: 'No recent activity data',
        };
      }

      const latestLog = recentLogs[0];
      const unknownSkipped = latestLog.unknownTxSkippedNoJito || 0;
      const totalProcessed = latestLog.totalTransactionsReceived || 0;

      // SIMPLE RULES - NO COMPLEX LOGIC
      // Calculate skip ratio for better bot detection
      const skipRatio = totalProcessed > 0 ? unknownSkipped / totalProcessed : 0;
      
      // Bot detection: High skip ratio (>80%) indicates bot behavior
      if (skipRatio > 0.8 && unknownSkipped > 100) {
        return {
          shouldLimitFetch: true,
          maxSignatures: 1000,
          reason: `High unknown transaction skip ratio: ${(skipRatio * 100).toFixed(1)}% (${unknownSkipped}/${totalProcessed})`,
          cacheHours: 6,
        };
      }

      // High volume but reasonable skip ratio - moderate limiting
      if (totalProcessed > 8000 && skipRatio > 0.3) {
        return {
          shouldLimitFetch: true,
          maxSignatures: 2000,
          reason: `High transaction volume with elevated skip ratio: ${totalProcessed} total, ${(skipRatio * 100).toFixed(1)}% skipped`,
          cacheHours: 3,
        };
      }

      // Very high volume regardless of skip ratio - basic limiting
      if (totalProcessed > 15000) {
        return {
          shouldLimitFetch: true,
          maxSignatures: 3000,
          reason: `Very high transaction volume: ${totalProcessed} total`,
          cacheHours: 2,
        };
      }

      return {
        shouldLimitFetch: false,
        maxSignatures: 10000,
        reason: 'Normal transaction volume',
      };
    } catch (error) {
      logger.error(`Error getting fetch recommendation for ${walletAddress}:`, error);
      return {
        shouldLimitFetch: false,
        maxSignatures: 10000,
        reason: 'Error occurred, using default',
      };
    }
  }

  /**
   * Update wallet classification - SIMPLE VERSION
   */
  async updateWalletClassification(
    walletAddress: string,
    classification: 'normal' | 'high_frequency' | 'unknown',
    reason?: string
  ): Promise<void> {
    try {
      await this.prismaClient.wallet.update({
        where: { address: walletAddress },
        data: { classification },
      });
      
      if (reason) {
        logger.debug(`Updated ${walletAddress} classification to ${classification}: ${reason}`);
      }
    } catch (error) {
      logger.error(`Error updating classification for ${walletAddress}:`, error);
      throw error;
    }
  }

  /**
   * Get wallet classification
   */
  async getWalletClassification(walletAddress: string): Promise<string | null> {
    try {
      const wallet = await this.prismaClient.wallet.findUnique({
        where: { address: walletAddress },
        select: { classification: true },
      });
      
      return wallet?.classification || null;
    } catch (error) {
      logger.error(`Error getting classification for ${walletAddress}:`, error);
      return null;
    }
  }
} 