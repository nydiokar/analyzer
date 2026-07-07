import { Injectable, Logger, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { prisma } from '../../core/services/database-service';
import { TokenHoldersService } from '../services/token-holders.service';
import { UserFavoritesService } from '../services/user-favorites.service';
import { isValidSolanaAddress } from '../shared/solana-address.pipe';
import { isAnalysisBlockingType, type KnownWalletType } from '../../config/known-wallets';
import type { CandidateDto, HuntListItemDto, HuntDetailDto, AddSnapshotResponseDto } from '../shared/dto/wallet-hunt.dto';

const MAX_HUNTS_PER_USER = 5;
const MAX_SNAPSHOTS_PER_HUNT = 10;
const INACTIVITY_WARN_DAYS = 14;
const INACTIVITY_DELETE_DAYS = 21;

interface SnapshotRecord {
  id: string;
  huntId: string;
  tokenMint: string;
  sourceType: string;
  capturedAt: Date;
  holders: string[];
  note: string | null;
}

@Injectable()
export class WalletHuntService {
  private readonly logger = new Logger(WalletHuntService.name);

  constructor(
    private readonly tokenHoldersService: TokenHoldersService,
    private readonly userFavoritesService: UserFavoritesService,
  ) {}

  async createHunt(userId: string, name: string): Promise<{ id: string; name: string; createdAt: Date; lastVisitedAt: Date }> {
    const existingCount = await prisma.walletHunt.count({
      where: { userId, archivedAt: null },
    });

    if (existingCount >= MAX_HUNTS_PER_USER) {
      throw new BadRequestException(`You have ${MAX_HUNTS_PER_USER} active hunts. Delete one to create a new hunt.`);
    }

    const hunt = await prisma.walletHunt.create({
      data: { userId, name },
    });

    return { id: hunt.id, name: hunt.name, createdAt: hunt.createdAt, lastVisitedAt: hunt.lastVisitedAt };
  }

  async getHunts(userId: string): Promise<HuntListItemDto[]> {
    const hunts = await prisma.walletHunt.findMany({
      where: { userId, archivedAt: null },
      include: { _count: { select: { snapshots: true } } },
      orderBy: { lastVisitedAt: 'desc' },
    });

    return hunts.map(h => ({
      id: h.id,
      name: h.name,
      snapshotCount: h._count.snapshots,
      createdAt: h.createdAt,
      lastVisitedAt: h.lastVisitedAt,
    }));
  }

  async getHunt(huntId: string, userId: string): Promise<HuntDetailDto> {
    const hunt = await prisma.walletHunt.findUnique({
      where: { id: huntId },
      include: { snapshots: { orderBy: { capturedAt: 'asc' } } },
    });

    if (!hunt) throw new NotFoundException('Hunt not found');
    if (hunt.archivedAt) throw new NotFoundException('Hunt archived');
    if (hunt.userId !== userId) throw new ForbiddenException('Not your hunt');

    // Update lastVisitedAt
    await prisma.walletHunt.update({
      where: { id: huntId },
      data: { lastVisitedAt: new Date() },
    });

    const candidates = this.computeCandidates(hunt.snapshots);

    return {
      hunt: {
        id: hunt.id,
        name: hunt.name,
        createdAt: hunt.createdAt,
        lastVisitedAt: new Date(),
      },
      snapshots: hunt.snapshots.map(s => ({
        id: s.id,
        tokenMint: s.tokenMint,
        sourceType: s.sourceType,
        capturedAt: s.capturedAt,
        holderCount: s.holders.length,
        note: s.note ?? undefined,
      })),
      candidates,
    };
  }

  async deleteHunt(huntId: string, userId: string): Promise<void> {
    const hunt = await prisma.walletHunt.findUnique({
      where: { id: huntId },
    });

    if (!hunt) throw new NotFoundException('Hunt not found');
    if (hunt.archivedAt) throw new NotFoundException('Hunt archived');
    if (hunt.userId !== userId) throw new ForbiddenException('Not your hunt');

    await prisma.walletHunt.delete({
      where: { id: huntId },
    });
  }

  async addSnapshot(
    huntId: string,
    userId: string,
    tokenMint: string,
    sourceType: string,
    note?: string,
  ): Promise<AddSnapshotResponseDto> {
    if (!isValidSolanaAddress(tokenMint)) {
      throw new BadRequestException('Invalid Solana address for tokenMint');
    }

    const hunt = await prisma.walletHunt.findUnique({
      where: { id: huntId },
      include: { snapshots: true },
    });

    if (!hunt) throw new NotFoundException('Hunt not found');
    if (hunt.archivedAt) throw new NotFoundException('Hunt archived');
    if (hunt.userId !== userId) throw new ForbiddenException('Not your hunt');

    if (hunt.snapshots.length >= MAX_SNAPSHOTS_PER_HUNT) {
      throw new BadRequestException(`Maximum ${MAX_SNAPSHOTS_PER_HUNT} snapshots per hunt reached`);
    }

    // Check for duplicate token+source combo
    const existing = hunt.snapshots.find(
      s => s.tokenMint === tokenMint && s.sourceType === sourceType,
    );
    if (existing) {
      throw new BadRequestException('This token/source combination already exists in this hunt');
    }

    // Fetch wallets from source
    const holders = await this.fetchWalletsForSource(tokenMint, sourceType);

    // Create snapshot
    const snapshot = await prisma.walletHuntSnapshot.create({
      data: {
        huntId,
        tokenMint,
        sourceType,
        holders,
        note: note ?? null,
      },
    });

    // Update lastVisitedAt
    await prisma.walletHunt.update({
      where: { id: huntId },
      data: { lastVisitedAt: new Date() },
    });

    // Recompute candidates with all snapshots
    const allSnapshots = [...hunt.snapshots, snapshot];
    const candidates = this.computeCandidates(allSnapshots);

    return {
      snapshot: {
        id: snapshot.id,
        tokenMint: snapshot.tokenMint,
        sourceType: snapshot.sourceType,
        capturedAt: snapshot.capturedAt,
        holderCount: snapshot.holders.length,
        note: snapshot.note ?? undefined,
      },
      candidates,
    };
  }

  async removeSnapshot(huntId: string, snapshotId: string, userId: string): Promise<void> {
    const hunt = await prisma.walletHunt.findUnique({
      where: { id: huntId },
    });

    if (!hunt) throw new NotFoundException('Hunt not found');
    if (hunt.archivedAt) throw new NotFoundException('Hunt archived');
    if (hunt.userId !== userId) throw new ForbiddenException('Not your hunt');

    const snapshot = await prisma.walletHuntSnapshot.findUnique({
      where: { id: snapshotId },
    });

    if (!snapshot || snapshot.huntId !== huntId) {
      throw new NotFoundException('Snapshot not found in this hunt');
    }

    await prisma.walletHuntSnapshot.delete({
      where: { id: snapshotId },
    });
  }

  async trackCandidate(huntId: string, userId: string, walletAddress: string): Promise<void> {
    if (!isValidSolanaAddress(walletAddress)) {
      throw new BadRequestException('Invalid Solana address');
    }

    const hunt = await prisma.walletHunt.findUnique({
      where: { id: huntId },
    });

    if (!hunt) throw new NotFoundException('Hunt not found');
    if (hunt.archivedAt) throw new NotFoundException('Hunt archived');
    if (hunt.userId !== userId) throw new ForbiddenException('Not your hunt');

    await this.userFavoritesService.addFavorite(userId, { walletAddress });
  }

  async fetchWalletsForSource(tokenMint: string, sourceType: string): Promise<string[]> {
    switch (sourceType) {
      case 'TOP_HOLDERS': {
        const result = await this.tokenHoldersService.getTopHolders(tokenMint);
        return result.holders
          .filter(h => h.ownerAccount && (!h.knownType || !isAnalysisBlockingType(h.knownType as KnownWalletType)))
          .map(h => h.ownerAccount!);
      }
      default:
        throw new BadRequestException(`Unknown source type: ${sourceType}`);
    }
  }

  computeCandidates(snapshots: SnapshotRecord[]): CandidateDto[] {
    if (snapshots.length === 0) return [];

    if (snapshots.length === 1) {
      return snapshots[0].holders.map(wallet => ({
        walletAddress: wallet,
        appearanceCount: 1,
        confidence: 1.0,
        tokenMints: [snapshots[0].tokenMint],
        sources: [snapshots[0].sourceType],
      }));
    }

    // Build wallet -> { tokens, sources } map
    const walletData = new Map<string, { tokens: Set<string>; sources: Set<string> }>();

    for (const snapshot of snapshots) {
      for (const wallet of snapshot.holders) {
        if (!walletData.has(wallet)) {
          walletData.set(wallet, { tokens: new Set(), sources: new Set() });
        }
        const data = walletData.get(wallet)!;
        data.tokens.add(snapshot.tokenMint);
        data.sources.add(snapshot.sourceType);
      }
    }

    // Count unique tokens across all snapshots
    const uniqueTokens = new Set(snapshots.map(s => s.tokenMint));
    const uniqueTokenCount = uniqueTokens.size;

    // Filter to wallets appearing in 2+ unique tokens, sort by count desc
    const candidates: CandidateDto[] = [];

    for (const [wallet, data] of walletData) {
      const appearanceCount = data.tokens.size;
      if (appearanceCount >= 2) {
        candidates.push({
          walletAddress: wallet,
          appearanceCount,
          confidence: appearanceCount / uniqueTokenCount,
          tokenMints: Array.from(data.tokens),
          sources: Array.from(data.sources),
        });
      }
    }

    return candidates.sort((a, b) => b.appearanceCount - a.appearanceCount);
  }

  // Daily cleanup at 3 AM
  @Cron('0 0 3 * * *')
  async cleanupInactiveHunts(): Promise<void> {
    const now = new Date();

    // Warn hunts > 14 days inactive (log only for now)
    const warnThreshold = new Date(now.getTime() - INACTIVITY_WARN_DAYS * 24 * 60 * 60 * 1000);
    const warnable = await prisma.walletHunt.findMany({
      where: { lastVisitedAt: { lt: warnThreshold }, archivedAt: null },
      select: { id: true, userId: true, name: true, lastVisitedAt: true },
    });

    if (warnable.length > 0) {
      this.logger.log(`Found ${warnable.length} hunts inactive for >${INACTIVITY_WARN_DAYS} days`);
    }

    // Archive hunts > 21 days inactive, preserving snapshots as future label evidence.
    const deleteThreshold = new Date(now.getTime() - INACTIVITY_DELETE_DAYS * 24 * 60 * 60 * 1000);
    const archived = await prisma.walletHunt.updateMany({
      where: { lastVisitedAt: { lt: deleteThreshold }, archivedAt: null },
      data: { archivedAt: now, archiveReason: 'inactive_cleanup' },
    });

    if (archived.count > 0) {
      this.logger.log(`Archived ${archived.count} hunts inactive for >${INACTIVITY_DELETE_DAYS} days`);
    }
  }
}
