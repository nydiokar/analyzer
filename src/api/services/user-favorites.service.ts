import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../services/database.service';
import { FavoriteWalletDetailDto, UpdateFavoriteWalletDto, AddFavoriteWalletDto } from '../shared/dto/favorite-wallet-detail.dto';
// Prisma types like UserFavoriteWallet are now handled by DatabaseService return types

@Injectable()
export class UserFavoritesService {
  constructor(private readonly databaseService: DatabaseService) {}

  async addFavorite(userId: string, addFavoriteDto: AddFavoriteWalletDto): Promise<void> {
    // All validation (user exists, wallet exists, conflict) is now handled by databaseService.addFavoriteWallet
    await this.databaseService.addFavoriteWallet(userId, addFavoriteDto.walletAddress);

    // If additional data is provided, update it immediately
    if (addFavoriteDto.nickname || addFavoriteDto.collections) {
      await this.updateFavorite(userId, addFavoriteDto.walletAddress, {
        nickname: addFavoriteDto.nickname,
        collections: addFavoriteDto.collections,
      });
    }
  }

  async removeFavorite(userId: string, walletAddress: string): Promise<void> {
    // NotFoundException for non-existent favorite is handled by databaseService.removeFavoriteWallet
    await this.databaseService.removeFavoriteWallet(userId, walletAddress);
  }

  async updateFavorite(userId: string, walletAddress: string, updateFavoriteWalletDto: UpdateFavoriteWalletDto): Promise<void> {
    // We'll add this method to DatabaseService
    await this.databaseService.updateFavoriteWallet(userId, walletAddress, {
      nickname: updateFavoriteWalletDto.nickname,
      collections: updateFavoriteWalletDto.collections ? JSON.stringify(updateFavoriteWalletDto.collections) : null,
      metadata: updateFavoriteWalletDto.metadata,
    });
  }

  async updateLastViewed(userId: string, walletAddress: string): Promise<void> {
    // We'll add this method to DatabaseService
    await this.databaseService.updateFavoriteWalletLastViewed(userId, walletAddress);
  }

  async getFavorites(userId: string): Promise<FavoriteWalletDetailDto[]> {
    // Use existing database service method
    const favoritesWithWalletData = await this.databaseService.getFavoriteWalletsByUserId(userId);

    return favoritesWithWalletData.map(fav => {
      let pnl: number | undefined = undefined;
      let winRate: number | undefined = undefined;
      let currentSolBalance: number | undefined = undefined;
      let lastActiveTimestamp: number | undefined = undefined;

      if (fav.wallet) {
        if (fav.wallet.pnlSummary) {
          // Calculate total PnL = realized + unrealized (same as Discover page)
          const realizedPnl = fav.wallet.pnlSummary.realizedPnl ?? 0;
          const unrealizedPnl = fav.wallet.pnlSummary.unrealizedPnl ?? 0;
          pnl = realizedPnl + unrealizedPnl;

          currentSolBalance = fav.wallet.pnlSummary.currentSolBalance ?? undefined;
          lastActiveTimestamp = fav.wallet.pnlSummary.overallLastTimestamp ?? undefined;

          // Get winrate from advancedStats (same as Discover page)
          if (fav.wallet.pnlSummary.advancedStats) {
            winRate = fav.wallet.pnlSummary.advancedStats.tokenWinRatePercent ?? undefined;
          }
        }
        if (fav.wallet.behaviorProfile) {
          // Fallback to behaviorProfile's lastTransactionTimestamp if pnlSummary doesn't have it
          if (!lastActiveTimestamp && fav.wallet.behaviorProfile.lastTransactionTimestamp) {
            lastActiveTimestamp = fav.wallet.behaviorProfile.lastTransactionTimestamp;
          }
        }
      }

      // Parse JSON fields safely
      let collections: string[] = [];

      try {
        if (fav.collections) {
          collections = JSON.parse(fav.collections);
        }
      } catch (e) {
        // If parsing fails, treat as empty array
        collections = [];
      }

      return {
        walletAddress: fav.walletAddress,
        knownType: fav.wallet?.knownType ?? undefined,
        knownLabel: fav.wallet?.knownLabel ?? undefined,
        nickname: fav.nickname,
        collections: collections,
        metadata: fav.metadata,
        favoritedAt: fav.createdAt,
        lastViewedAt: fav.lastViewedAt,
        pnl: pnl,
        winRate: winRate,
        currentSolBalance: currentSolBalance,
        lastActiveTimestamp: lastActiveTimestamp,
      };
    });
  }

  // Helper method to get all unique collections used by a user
  async getUserCollections(userId: string): Promise<string[]> {
    const collections = await this.databaseService.getUserFavoriteCollections(userId);
    return collections;
  }
} 
