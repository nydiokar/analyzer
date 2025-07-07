import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { FavoriteWalletDetailDto, UpdateFavoriteWalletDto, AddFavoriteWalletDto } from './favorite-wallet-detail.dto';
// Prisma types like UserFavoriteWallet are now handled by DatabaseService return types

@Injectable()
export class UserFavoritesService {
  constructor(private readonly databaseService: DatabaseService) {}

  async addFavorite(userId: string, addFavoriteDto: AddFavoriteWalletDto): Promise<void> {
    // All validation (user exists, wallet exists, conflict) is now handled by databaseService.addFavoriteWallet
    await this.databaseService.addFavoriteWallet(userId, addFavoriteDto.walletAddress);
    
    // If additional data is provided, update it immediately
    if (addFavoriteDto.nickname || addFavoriteDto.tags || addFavoriteDto.collections) {
      await this.updateFavorite(userId, addFavoriteDto.walletAddress, {
        nickname: addFavoriteDto.nickname,
        tags: addFavoriteDto.tags,
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
      tags: updateFavoriteWalletDto.tags ? JSON.stringify(updateFavoriteWalletDto.tags) : null,
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

      if (fav.wallet) {
        if (fav.wallet.pnlSummary) {
          pnl = fav.wallet.pnlSummary.realizedPnl ?? undefined;
        }
        if (fav.wallet.behaviorProfile) {
          winRate = fav.wallet.behaviorProfile.flipperScore ?? undefined;
        }
      }

      // Parse JSON fields safely
      let tags: string[] = [];
      let collections: string[] = [];
      
      try {
        if (fav.tags) {
          tags = JSON.parse(fav.tags);
        }
      } catch (e) {
        // If parsing fails, treat as empty array
        tags = [];
      }
      
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
        nickname: fav.nickname,
        tags: tags,
        collections: collections,
        metadata: fav.metadata,
        favoritedAt: fav.createdAt,
        lastViewedAt: fav.lastViewedAt,
        pnl: pnl, 
        winRate: winRate,
      };
    });
  }

  // Helper method to get all unique tags used by a user
  async getUserTags(userId: string): Promise<string[]> {
    const favorites = await this.databaseService.getUserFavoriteTags(userId);
    return favorites;
  }

  // Helper method to get all unique collections used by a user
  async getUserCollections(userId: string): Promise<string[]> {
    const collections = await this.databaseService.getUserFavoriteCollections(userId);
    return collections;
  }
} 