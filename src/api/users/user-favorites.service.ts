import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { FavoriteWalletDetailDto } from './favorite-wallet-detail.dto';
// Prisma types like UserFavoriteWallet are now handled by DatabaseService return types

@Injectable()
export class UserFavoritesService {
  constructor(private readonly databaseService: DatabaseService) {}

  async addFavorite(userId: string, walletAddress: string): Promise<void> {
    // All validation (user exists, wallet exists, conflict) is now handled by databaseService.addFavoriteWallet
    await this.databaseService.addFavoriteWallet(userId, walletAddress);
  }

  async removeFavorite(userId: string, walletAddress: string): Promise<void> {
    // NotFoundException for non-existent favorite is handled by databaseService.removeFavoriteWallet
    await this.databaseService.removeFavoriteWallet(userId, walletAddress);
  }

  async getFavorites(userId: string): Promise<FavoriteWalletDetailDto[]> {
    // NotFoundException for non-existent user is handled by databaseService.getFavoriteWalletsByUserId
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

      return {
        walletAddress: fav.walletAddress,
        favoritedAt: fav.createdAt,
        pnl: pnl, 
        winRate: winRate, 
      };
    });
  }
} 