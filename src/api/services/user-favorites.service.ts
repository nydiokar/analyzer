import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { DatabaseService } from '../services/database.service';
import { FavoriteWalletDetailDto, UpdateFavoriteWalletDto, AddFavoriteWalletDto } from '../shared/dto/favorite-wallet-detail.dto';
import { BulkImportFavoriteWalletsDto, BulkImportWalletItemDto } from '../shared/dto/favorite-wallet-import.dto';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';
import { USER_FAVORITES_CONFIG } from '../../config/constants';
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

  async importFavorites(userId: string, dto: BulkImportFavoriteWalletsDto): Promise<{
    requested: number;
    valid: number;
    invalidWallets: string[];
    added: number;
    updated: number;
    skipped: number;
    overLimit: number;
    normalizedWallets: string[];
    createdWallets: string[];
  }> {
    // Check import cooldown before processing
    await this.checkImportCooldown(userId);

    const wallets = Array.isArray(dto.wallets) ? dto.wallets : [];
    if (wallets.length === 0) {
      return {
        requested: 0,
        valid: 0,
        invalidWallets: [],
        added: 0,
        updated: 0,
        skipped: 0,
        overLimit: 0,
        normalizedWallets: [],
        createdWallets: [],
      };
    }

    const defaultCollections = this.normalizeCollections(dto.defaultCollections);
    const invalidWallets: string[] = [];
    const normalizedMap = new Map<string, { walletAddress: string; nickname?: string; collections?: string[]; metadata?: any }>();

    for (const item of wallets) {
      const walletAddress = this.extractWalletAddress(item);
      if (!walletAddress || !isValidSolanaAddress(walletAddress)) {
        if (walletAddress) {
          invalidWallets.push(walletAddress);
        }
        continue;
      }

      const nickname = item.nickname || item.name || undefined;
      const itemCollections = this.normalizeCollections(item.collections || item.collection);
      const collections = Array.from(new Set([...defaultCollections, ...itemCollections]));

      const metadata = this.buildImportMetadata(item);

      const existing = normalizedMap.get(walletAddress);
      if (!existing) {
        normalizedMap.set(walletAddress, {
          walletAddress,
          nickname,
          collections: collections.length > 0 ? collections : undefined,
          metadata,
        });
      } else {
        if (!existing.nickname && nickname) {
          existing.nickname = nickname;
        }
        if (collections.length > 0) {
          existing.collections = Array.from(new Set([...(existing.collections || []), ...collections]));
        }
        if (metadata && typeof metadata === 'object') {
          const base = existing.metadata && typeof existing.metadata === 'object' ? existing.metadata : {};
          existing.metadata = { ...base, ...metadata };
        }
      }
    }

    const normalizedFavorites = Array.from(normalizedMap.values());
    const normalizedWallets = normalizedFavorites.map(entry => entry.walletAddress);

    if (normalizedFavorites.length === 0) {
      return {
        requested: wallets.length,
        valid: 0,
        invalidWallets,
        added: 0,
        updated: 0,
        skipped: 0,
        overLimit: 0,
        normalizedWallets,
        createdWallets: [],
      };
    }

    const result = await this.databaseService.bulkUpsertFavoriteWallets({
      userId,
      favorites: normalizedFavorites,
      mergeCollections: dto.mergeCollections ?? true,
      overwriteNickname: dto.overwriteNickname ?? false,
      mergeMetadata: true,
    });

    // Update last bulk import timestamp on success
    if (result.added > 0 || result.updated > 0) {
      await this.databaseService.updateUserLastBulkImport(userId);
    }

    return {
      requested: wallets.length,
      valid: normalizedFavorites.length,
      invalidWallets,
      added: result.added,
      updated: result.updated,
      skipped: result.skipped,
      overLimit: result.overLimit,
      normalizedWallets,
      createdWallets: result.createdWallets,
    };
  }

  private extractWalletAddress(item: BulkImportWalletItemDto): string | undefined {
    return item.walletAddress || item.trackedWalletAddress || undefined;
  }

  private normalizeCollections(input?: string[] | string): string[] {
    if (!input) return [];
    if (Array.isArray(input)) {
      return input.map(entry => entry.trim()).filter(Boolean);
    }
    if (typeof input === 'string') {
      return [input.trim()].filter(Boolean);
    }
    return [];
  }

  private buildImportMetadata(item: BulkImportWalletItemDto): any | undefined {
    const metadata = {
      ...((item.metadata && typeof item.metadata === 'object') ? item.metadata : {}),
      ...(item.emoji ? { emoji: item.emoji } : {}),
      ...(typeof item.alertsOn === 'boolean' ? { alertsOn: item.alertsOn } : {}),
    };

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  /**
   * Get wallets in a specific collection
   */
  async getWalletsInCollection(userId: string, collectionName: string): Promise<string[]> {
    const favorites = await this.databaseService.getFavoriteWalletsByUserId(userId);

    return favorites
      .filter(fav => {
        if (!fav.collections) return false;
        try {
          const collections = JSON.parse(fav.collections);
          return Array.isArray(collections) && collections.includes(collectionName);
        } catch {
          return false;
        }
      })
      .map(fav => fav.walletAddress);
  }

  /**
   * Check if user can perform bulk import (enforces cooldown)
   */
  private async checkImportCooldown(userId: string): Promise<void> {
    const user = await this.databaseService.getUserById(userId);
    if (!user) {
      throw new NotFoundException(`User not found`);
    }

    if (user.lastBulkImportAt) {
      const cooldownMs = USER_FAVORITES_CONFIG.IMPORT_COOLDOWN_SECONDS * 1000;
      const elapsed = Date.now() - user.lastBulkImportAt.getTime();

      if (elapsed < cooldownMs) {
        const remainingSec = Math.ceil((cooldownMs - elapsed) / 1000);
        const remainingMin = Math.ceil(remainingSec / 60);
        throw new ConflictException(
          `Import available in ${remainingMin} minute${remainingMin !== 1 ? 's' : ''} (${remainingSec} seconds)`
        );
      }
    }
  }
} 
