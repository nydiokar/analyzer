import { Injectable, Logger } from '@nestjs/common';
import { prisma } from '../../core/services/database-service';
import { BalanceCacheService } from './balance-cache.service';
import { TokenInfoService } from './token-info.service';
import { TokenBalanceDetails } from '../../types/wallet';

const DUST_USD_THRESHOLD = 80;
const DUST_BALANCE_THRESHOLD = 200;
// Tokens with no price data are held to a stricter balance threshold to prevent
// garbage memecoins (huge supply, no liquidity) from flooding the feed.
const DUST_BALANCE_THRESHOLD_NO_PRICE = 500_000;

export interface SnapshotResult {
  wallet: string;
  newTokens: number;
  updatedTokens: number;
  deactivatedTokens: number;
}

@Injectable()
export class RadarSnapshotService {
  private readonly logger = new Logger(RadarSnapshotService.name);

  constructor(
    private readonly balanceCacheService: BalanceCacheService,
    private readonly tokenInfoService: TokenInfoService,
  ) {}

  async runSnapshot(walletAddress: string): Promise<SnapshotResult> {
    this.logger.debug(`Running snapshot for ${walletAddress}`);

    const walletBalance = await this.balanceCacheService.getBalances(walletAddress);
    const rawBalances: TokenBalanceDetails[] = walletBalance?.tokenBalances ?? [];

    // Fetch live prices via Redis cache → DexScreener (same path as wallet-hud, similarity, etc.)
    const mints = rawBalances.map((t) => t.mint);
    const priceByMint = mints.length > 0 ? await this.tokenInfoService.getTokenPrices(mints) : new Map<string, number>();

    const tokenBalances: TokenBalanceDetails[] = rawBalances.map((t) => {
      const price = priceByMint.get(t.mint);
      return {
        ...t,
        valueUsd: price != null ? t.uiBalance * price : undefined,
      };
    });

    // All tokens still present in the wallet — used for deactivation and updates
    const presentMints = new Set(tokenBalances.map((t) => t.mint));

    const existing = await prisma.radarHolding.findMany({
      where: { wallet: walletAddress },
      select: { tokenMint: true, isActiveHolding: true },
    });
    const existingByMint = new Map(existing.map((h) => [h.tokenMint, h]));

    const now = new Date();
    let newTokens = 0;
    let updatedTokens = 0;

    for (const token of tokenBalances) {
      if (!existingByMint.has(token.mint)) {
        // New token — apply dust filter before admitting
        if (!this.passesDustFilter(token)) continue;
        await prisma.radarHolding.create({
          data: {
            wallet: walletAddress,
            tokenMint: token.mint,
            firstSeenAt: now,
            lastSeenAt: now,
            uiBalance: token.uiBalance,
            usdValue: token.valueUsd ?? null,
            isActiveHolding: true,
            reviewStatus: 'unreviewed',
          },
        });
        newTokens++;
      } else {
        // Existing token — refresh balance + price, and re-apply dust filter.
        // Tokens that no longer pass (price now known and below threshold) get auto-ignored.
        const passes = this.passesDustFilter(token);
        await prisma.radarHolding.update({
          where: { wallet_tokenMint: { wallet: walletAddress, tokenMint: token.mint } },
          data: {
            lastSeenAt: now,
            uiBalance: token.uiBalance,
            usdValue: token.valueUsd ?? null,
            isActiveHolding: true,
            ...(passes ? {} : { reviewStatus: 'ignored', reviewedAt: now }),
          },
        });
        updatedTokens++;
      }
    }

    const mintsToDeactivate = existing
      .filter((h) => h.isActiveHolding && !presentMints.has(h.tokenMint))
      .map((h) => h.tokenMint);

    let deactivatedTokens = 0;
    if (mintsToDeactivate.length > 0) {
      const result = await prisma.radarHolding.updateMany({
        where: { wallet: walletAddress, tokenMint: { in: mintsToDeactivate } },
        data: { isActiveHolding: false, lastSeenAt: now },
      });
      deactivatedTokens = result.count;
    }

    this.logger.debug(
      `Snapshot done for ${walletAddress}: +${newTokens} new, ${updatedTokens} updated, ${deactivatedTokens} deactivated`,
    );

    return { wallet: walletAddress, newTokens, updatedTokens, deactivatedTokens };
  }

  private passesDustFilter(token: TokenBalanceDetails): boolean {
    if (token.valueUsd !== undefined) {
      return token.valueUsd >= DUST_USD_THRESHOLD;
    }
    // No price data — apply strict balance threshold to avoid garbage memecoins
    return token.uiBalance >= DUST_BALANCE_THRESHOLD_NO_PRICE;
  }
}
