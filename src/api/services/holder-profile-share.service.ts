import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { prisma } from '../../core/services/database-service';
import type { Prisma } from '@prisma/client';
import type { HolderProfile, HolderProfilesResult } from '../../queues/jobs/types';

interface PersistedTokenSnapshot {
  marketCapUsd?: number | null;
  priceUsd?: string | number | null;
  name?: string | null;
  symbol?: string | null;
}

interface PersistedSimilarityPairSnapshot {
  walletA: string;
  walletB: string;
  binaryScore: number;
  capitalScore: number;
  binarySharedTokenCount: number;
  binaryUniqueTokenCountA: number;
  binaryUniqueTokenCountB: number;
}

interface PersistedSimilaritySnapshot {
  version: 1;
  walletCount: number;
  pairs: PersistedSimilarityPairSnapshot[];
}

interface PersistedHolderProfilesResult extends HolderProfilesResult {
  tokenSnapshot?: PersistedTokenSnapshot | null;
}

export interface ShareSnapshot {
  mode: string;
  tokenMint?: string;
  tokenSymbol?: string | null;
  topN?: number;
  tokenSnapshot?: PersistedTokenSnapshot | null;
  similaritySnapshot?: PersistedSimilaritySnapshot | null;
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

  /**
   * Create a share from a persisted holder-profiles snapshot run.
   * Shares are version-based: callers must provide the exact jobId they want to publish.
   */
  async createShare(params: {
    tokenMint: string;
    jobId: string;
    userId?: string;
    similaritySnapshot?: PersistedSimilaritySnapshot | null;
  }): Promise<{ shareId: string; url: string }> {
    const { tokenMint, jobId, userId, similaritySnapshot } = params;

    const shareSource = await this.getTokenResultFromSnapshotRun(tokenMint, jobId);
    if (!shareSource) {
      throw new NotFoundException(
        `No holder-profiles snapshot found for mint=${tokenMint} jobId=${jobId}.`,
      );
    }
    const { result, topN } = shareSource;

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
      tokenSymbol: tokenSymbol ?? null,
      topN,
      tokenSnapshot: result.tokenSnapshot ?? null,
      similaritySnapshot: similaritySnapshot ?? null,
      profiles: strippedProfiles,
      metadata: result.metadata,
    };

    const record = await prisma.holderProfileShare.create({
      data: {
        snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
        tokenMint,
        tokenSymbol,
        topN: snapshot.topN ?? null,
        createdBy: userId ?? null,
      },
    });

    this.logger.log(`Created share ${record.id} for mint=${tokenMint} topN=${topN ?? 'n/a'} by user=${userId ?? 'anon'}`);

    return {
      shareId: record.id,
      url: `/share/hp/${record.id}`,
    };
  }

  private async getTokenResultFromSnapshotRun(
    tokenMint: string,
    jobId: string,
  ): Promise<{ result: PersistedHolderProfilesResult; topN: number | null } | null> {
    const snapshots = await prisma.holderProfileSnapshot.findMany({
      where: {
        tokenMint,
        jobId,
        analysisMode: 'token',
      },
      orderBy: { holderRank: 'asc' },
    });

    if (snapshots.length === 0) {
      return null;
    }

    const firstMeta = snapshots[0]?.metadata as Record<string, unknown> | null;
    const topN = snapshots[0]?.topN ?? null;
    const knownWalletStubs = Array.isArray(firstMeta?.knownWalletStubs)
      ? (firstMeta.knownWalletStubs as HolderProfile[])
      : [];
    const tokenSnapshot = (firstMeta?.tokenSnapshot ?? null) as PersistedTokenSnapshot | null;
    const analyzedProfiles = snapshots.map((snapshot) => snapshot.profile as unknown as HolderProfile);
    const allProfiles = [...analyzedProfiles, ...knownWalletStubs].sort(
      (a, b) => (a.rank ?? 0) - (b.rank ?? 0),
    );

    return {
      topN,
      result: {
        success: true,
        timestamp: Date.now(),
        mode: 'token',
        tokenMint,
        tokenSnapshot,
        profiles: allProfiles,
        metadata: {
          totalHoldersRequested: allProfiles.length,
          totalHoldersAnalyzed: analyzedProfiles.length,
          totalProcessingTimeMs: 0,
          avgProcessingTimePerWalletMs: 0,
        },
      },
    };
  }

  /**
   * Fetch a share record by ID without incrementing the view counter.
   * Used by server-side rendering paths (OG image, metadata) that must not
   * pollute the view count analytics.
   */
  async getShareRaw(shareId: string): Promise<ShareRecord | null> {
    const record = await prisma.holderProfileShare.findUnique({
      where: { id: shareId },
    });
    if (!record) return null;
    if (record.expiresAt && record.expiresAt < new Date()) return null;
    return this.toShareRecord(record);
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

    return this.toShareRecord(record);
  }

  private toShareRecord(record: {
    id: string;
    snapshotJson: unknown;
    tokenMint: string | null;
    tokenSymbol: string | null;
    topN: number | null;
    createdAt: Date;
    expiresAt: Date | null;
    viewCount: number;
  }): ShareRecord {
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
