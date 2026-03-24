import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../queues/config/redis.provider';
import { prisma } from '../../core/services/database-service';
import type { HolderProfile, HolderProfilesResult } from '../../queues/jobs/types';

export interface ShareSnapshot {
  mode: string;
  tokenMint?: string;
  tokenSymbol?: string;
  topN?: number;
  profiles: Array<Pick<
    HolderProfile,
    | 'walletAddress'
    | 'rank'
    | 'supplyPercent'
    | 'behaviorType'
    | 'medianHoldTimeHours'
    | 'avgHoldTimeHours'
    | 'walletRealizedPnlSol'
    | 'solBalance'
    | 'dataQualityTier'
    | 'completedCycleCount'
    | 'exitPattern'
    | 'tokenHoldingValueSol'
    | 'knownType'
    | 'knownLabel'
    | 'analysisSkipped'
  >>;
  metadata: {
    totalHoldersRequested: number;
    totalHoldersAnalyzed: number;
    totalProcessingTimeMs: number;
    avgProcessingTimePerWalletMs: number;
  };
}

export interface ShareRecord {
  id: string;
  snapshot: ShareSnapshot;
  tokenMint: string | null;
  tokenSymbol: string | null;
  topN: number | null;
  createdAt: Date;
  expiresAt: Date | null;
  viewCount: number;
}


@Injectable()
export class HolderProfileShareService {
  private readonly logger = new Logger(HolderProfileShareService.name);

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Create a share from the current cached holder-profiles result for a token.
   * Reads from Redis Tier-1 cache. Strips large fields before persisting.
   */
  async createShare(params: {
    tokenMint: string;
    topN: number;
    userId?: string;
  }): Promise<{ shareId: string; url: string }> {
    const { tokenMint, topN, userId } = params;

    const cacheKey = `holder-profiles:token:${tokenMint}:${topN}`;
    const cached = await this.redis.get(cacheKey);
    if (!cached) {
      throw new NotFoundException(
        `No cached holder-profiles result for mint=${tokenMint} topN=${topN}. Run the analysis first.`,
      );
    }

    const result: HolderProfilesResult = JSON.parse(cached);

    // Pick only the fields we need — keeps persisted JSON small
    const strippedProfiles: ShareSnapshot['profiles'] = result.profiles.map((p) => ({
      walletAddress: p.walletAddress,
      rank: p.rank,
      supplyPercent: p.supplyPercent,
      behaviorType: p.behaviorType,
      medianHoldTimeHours: p.medianHoldTimeHours,
      avgHoldTimeHours: p.avgHoldTimeHours,
      walletRealizedPnlSol: p.walletRealizedPnlSol,
      solBalance: p.solBalance,
      dataQualityTier: p.dataQualityTier,
      completedCycleCount: p.completedCycleCount,
      exitPattern: p.exitPattern,
      tokenHoldingValueSol: p.tokenHoldingValueSol,
      knownType: p.knownType,
      knownLabel: p.knownLabel,
      analysisSkipped: p.analysisSkipped,
    }));

    // Token symbol — best-effort, non-blocking
    let tokenSymbol: string | null = null;
    try {
      const tokenInfo = await prisma.tokenInfo.findUnique({
        where: { tokenAddress: tokenMint },
        select: { symbol: true, onchainSymbol: true },
      });
      tokenSymbol = tokenInfo?.symbol ?? tokenInfo?.onchainSymbol ?? null;
    } catch {
      // Non-fatal — share works without symbol
    }

    const snapshot: ShareSnapshot = {
      mode: result.mode,
      tokenMint,
      tokenSymbol: tokenSymbol ?? undefined,
      topN,
      profiles: strippedProfiles,
      metadata: result.metadata,
    };

    const record = await prisma.holderProfileShare.create({
      data: {
        snapshotJson: snapshot as object,
        tokenMint,
        tokenSymbol,
        topN,
        createdBy: userId ?? null,
      },
    });

    this.logger.log(`Created share ${record.id} for mint=${tokenMint} topN=${topN} by user=${userId ?? 'anon'}`);

    return {
      shareId: record.id,
      url: `/share/hp/${record.id}`,
    };
  }

  /**
   * Fetch a share record by ID and increment view count.
   * View count increment is fire-and-forget — never blocks the response.
   */
  async getShare(shareId: string): Promise<ShareRecord> {
    const record = await prisma.holderProfileShare.findUnique({
      where: { id: shareId },
    });

    if (!record) {
      throw new NotFoundException(`Share not found: ${shareId}`);
    }

    if (record.expiresAt && record.expiresAt < new Date()) {
      throw new NotFoundException(`Share has expired: ${shareId}`);
    }

    // Fire-and-forget — don't delay the response for an analytics counter
    prisma.holderProfileShare
      .update({ where: { id: shareId }, data: { viewCount: { increment: 1 } } })
      .catch((err) => this.logger.warn(`Failed to increment viewCount for ${shareId}: ${err?.message}`));

    return {
      id: record.id,
      snapshot: record.snapshotJson as unknown as ShareSnapshot,
      tokenMint: record.tokenMint,
      tokenSymbol: record.tokenSymbol,
      topN: record.topN,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
      viewCount: record.viewCount,
    };
  }
}
