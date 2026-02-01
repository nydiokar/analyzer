import { Controller, Post, Delete, Patch, Get, Body, Param, Req, HttpCode, HttpStatus, Res, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { User } from '@prisma/client';
import { UserFavoritesService } from '../services/user-favorites.service';
import { AddFavoriteWalletDto, FavoriteWalletDetailDto, UpdateFavoriteWalletDto } from '../shared/dto/favorite-wallet-detail.dto';
import { BulkImportFavoriteWalletsDto } from '../shared/dto/favorite-wallet-import.dto';
import { BatchAnalyzeFavoritesDto } from '../shared/dto/batch-analyze-favorites.dto';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import type { DashboardWalletAnalysisJobData } from '../../queues/jobs/types';
import { JobPriority } from '../../queues/config/queue.config';
import { DASHBOARD_ANALYSIS_SCOPE_DEFAULTS, USER_FAVORITES_CONFIG } from '../../config/constants';
import type { DashboardAnalysisScope } from '../../shared/dashboard-analysis.types';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('User Favorites')
@Controller('users/me/favorites')
@ApiBearerAuth()
export class UserFavoritesController {
  constructor(
    private readonly userFavoritesService: UserFavoritesService,
    private readonly analysisOperationsQueue: AnalysisOperationsQueue,
  ) {}

  @Post()
  @ApiOperation({ summary: "Add a wallet to the authenticated user's favorites" })
  @ApiBody({ type: AddFavoriteWalletDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Wallet added to favorites.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized (API key missing or invalid).' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User (from API key) or Wallet not found.' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Wallet already in favorites.' })
  @HttpCode(HttpStatus.CREATED)
  async addFavorite(
    @Body() addFavoriteWalletDto: AddFavoriteWalletDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }
    await this.userFavoritesService.addFavorite(userId, addFavoriteWalletDto);

    // Auto-queue flash analysis for newly added wallet
    const scope = 'flash' as const;
    const flashTargetSignatures = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS.flash.targetSignatureCount;
    const requestId = `add-favorite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const jobData: DashboardWalletAnalysisJobData = {
      walletAddress: addFavoriteWalletDto.walletAddress,
      userId,
      requestId,
      analysisScope: scope,
      triggerSource: 'auto',
      targetSignatureCount: flashTargetSignatures,
      forceRefresh: false,
      queueWorkingAfter: false,
      queueDeepAfter: false,
    };

    await this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
      priority: JobPriority.NORMAL,
      delay: 0,
    });

    res.status(HttpStatus.CREATED).end();
  }

  @Delete(':walletAddress')
  @ApiOperation({ summary: "Remove a wallet from the authenticated user's favorites" })
  @ApiParam({ name: 'walletAddress', description: 'The wallet address to remove', type: String })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Wallet removed from favorites.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized (API key missing or invalid).' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Favorite entry not found for this user.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFavorite(
    @Param('walletAddress') walletAddress: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user!.id;
    await this.userFavoritesService.removeFavorite(userId, walletAddress);
    res.status(HttpStatus.NO_CONTENT).end();
  }

  @Delete()
  @ApiOperation({ summary: "Remove all wallets from the authenticated user's favorites" })
  @ApiResponse({ status: HttpStatus.OK, description: 'All favorites removed.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized (API key missing or invalid).' })
  async clearFavorites(
    @Req() req: AuthenticatedRequest,
  ): Promise<{ removed: number }> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }
    const removed = await this.userFavoritesService.clearFavorites(userId);
    return { removed };
  }

  @Patch(':walletAddress')
  @ApiOperation({ summary: "Update a favorite wallet's metadata" })
  @ApiParam({ name: 'walletAddress', description: 'The wallet address to update', type: String })
  @ApiBody({ type: UpdateFavoriteWalletDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Favorite wallet updated successfully.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Favorite wallet not found.' })
  async updateFavorite(
    @Param('walletAddress') walletAddress: string,
    @Body() updateFavoriteWalletDto: UpdateFavoriteWalletDto,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }
    await this.userFavoritesService.updateFavorite(userId, walletAddress, updateFavoriteWalletDto);
    res.status(HttpStatus.OK).set('Content-Length', '0').end();
  }

  @Post(':walletAddress/viewed')
  @ApiOperation({ summary: "Mark a favorite wallet as viewed" })
  @ApiParam({ name: 'walletAddress', description: 'The wallet address that was viewed', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'Wallet view timestamp updated.' })
  @HttpCode(HttpStatus.OK)
  async markAsViewed(
    @Param('walletAddress') walletAddress: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }
    await this.userFavoritesService.updateLastViewed(userId, walletAddress);
    res.status(HttpStatus.OK).end();
  }

  @Get()
  @ApiOperation({ summary: "Get the authenticated user's favorite wallets" })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of favorite wallets.', type: [FavoriteWalletDetailDto] })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized (API key missing or invalid).' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User (from API key) not found.'})
  async getFavorites(
    @Req() req: AuthenticatedRequest,
  ): Promise<FavoriteWalletDetailDto[]> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }
    return this.userFavoritesService.getFavorites(userId);
  }

  @Get('collections')
  @ApiOperation({ summary: "Get all unique collections used by the authenticated user" })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of unique collections.', type: [String] })
  async getUserCollections(
    @Req() req: AuthenticatedRequest,
  ): Promise<string[]> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }
    return this.userFavoritesService.getUserCollections(userId);
  }

  @Post('import')
  @ApiOperation({
    summary: 'Bulk import wallets into favorites with auto-analysis',
    description: `Imports up to 300 wallets and automatically queues flash analysis:
- First 50 wallets: Analyzed immediately (HIGH priority)
- Remaining 250: Queued for background analysis over 1 hour (LOW priority)

Rate Limit: 1 import per hour per user

For deep analysis, use the batch-analyze endpoint after import.`
  })
  @ApiBody({ type: BulkImportFavoriteWalletsDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Wallets imported and analysis queued successfully.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input.' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Import cooldown active (must wait 1 hour between imports).' })
  @HttpCode(HttpStatus.CREATED)
  async importFavorites(
    @Body() dto: BulkImportFavoriteWalletsDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{
    requested: number;
    valid: number;
    invalidWallets: string[];
    added: number;
    updated: number;
    skipped: number;
    overLimit: number;
    analysisQueued?: number;
    analysisRequestId?: string;
    analysisJobIds?: string[];
  }> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const importResult = await this.userFavoritesService.importFavorites(userId, dto);
    const { createdWallets, ...publicResult } = importResult;

    // Auto-queue flash analysis for newly created wallets
    // Strategy: First 50 immediate (HIGH priority), remaining 250 background (LOW priority, staggered)
    const walletsToAnalyze = createdWallets;
    if (walletsToAnalyze.length === 0) {
      return publicResult;
    }

    const scope = 'flash' as const;
    const flashTargetSignatures = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS.flash.targetSignatureCount;
    const requestId = `bulk-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Split into immediate and background batches
    const immediateWallets = walletsToAnalyze.slice(0, USER_FAVORITES_CONFIG.IMPORT_FLASH_IMMEDIATE);
    const backgroundWallets = walletsToAnalyze.slice(
      USER_FAVORITES_CONFIG.IMPORT_FLASH_IMMEDIATE,
      USER_FAVORITES_CONFIG.IMPORT_FLASH_IMMEDIATE + USER_FAVORITES_CONFIG.IMPORT_FLASH_BACKGROUND
    );

    const jobIds: string[] = [];

    // Queue immediate batch (HIGH priority, no delay)
    if (immediateWallets.length > 0) {
      const jobs = await Promise.all(
        immediateWallets.map(walletAddress => {
          const jobData: DashboardWalletAnalysisJobData = {
            walletAddress,
            userId,
            requestId,
            analysisScope: scope,
            triggerSource: 'system',
            targetSignatureCount: flashTargetSignatures,
            forceRefresh: false,
            queueWorkingAfter: false,
            queueDeepAfter: false,
          };
          return this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
            priority: JobPriority.HIGH,
            delay: 0,
          });
        })
      );

      // Always include job IDs so frontend can track progress
      jobs.forEach(job => {
        if (job.id) {
          jobIds.push(String(job.id));
        }
      });
    }

    // Queue background batch (LOW priority, staggered delays)
    if (backgroundWallets.length > 0) {
      const delayIncrement = USER_FAVORITES_CONFIG.IMPORT_BACKGROUND_DELAY_MS;
      const jobs = await Promise.all(
        backgroundWallets.map((walletAddress, idx) => {
          const jobData: DashboardWalletAnalysisJobData = {
            walletAddress,
            userId,
            requestId,
            analysisScope: scope,
            triggerSource: 'system',
            targetSignatureCount: flashTargetSignatures,
            forceRefresh: false,
            queueWorkingAfter: false,
            queueDeepAfter: false,
          };
          return this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
            priority: JobPriority.LOW,
            delay: idx * delayIncrement, // Spread over time
          });
        })
      );

      // Always include job IDs so frontend can track progress
      jobs.forEach(job => {
        if (job.id) {
          jobIds.push(String(job.id));
        }
      });
    }

    return {
      ...publicResult,
      analysisQueued: immediateWallets.length + backgroundWallets.length,
      analysisRequestId: requestId,
      analysisJobIds: jobIds,
    };
  }

  @Post('batch-analyze')
  @ApiOperation({
    summary: 'Queue analysis for multiple favorite wallets',
    description: `Analyze up to 20 favorite wallets at once.

- Wallets analyzed recently will be skipped automatically (processor checks freshness)
- Use 'flash' for quick refresh (7 days, 250 sigs)
- Use 'working' for medium depth (30 days, 2000 sigs)
- Use 'deep' for full history (all time, 3000 sigs)

Max: 20 wallets per request`
  })
  @ApiBody({ type: BatchAnalyzeFavoritesDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Analysis jobs queued successfully.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input or too many wallets.' })
  @HttpCode(HttpStatus.CREATED)
  async batchAnalyze(
    @Body() dto: BatchAnalyzeFavoritesDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<{
    queued: number;
    requestId: string;
  }> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    const { walletAddresses, scope } = dto;
    const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[scope];
    const requestId = `batch-${scope}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Queue all wallets - processor will skip if recently analyzed
    const jobs = await Promise.all(
      walletAddresses.map(walletAddress => {
        const jobData: DashboardWalletAnalysisJobData = {
          walletAddress,
          userId,
          requestId,
          analysisScope: scope,
          triggerSource: 'manual',
          targetSignatureCount: scopeDefaults.targetSignatureCount,
          forceRefresh: false, // Let processor check freshness
          queueWorkingAfter: false,
          queueDeepAfter: false,
        };
        return this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
          priority: JobPriority.NORMAL,
          delay: 0,
        });
      })
    );

    return {
      queued: jobs.length,
      requestId,
    };
  }

  @Post('collections/:name/refresh')
  @ApiOperation({
    summary: 'Refresh all wallets in a collection',
    description: `Queue flash analysis for all wallets in a collection.

- Max 100 wallets per collection
- Uses flash scope (7 days, 250 sigs)
- Wallets analyzed recently will be skipped automatically (processor checks freshness)
- Jobs queued with LOW priority to avoid overwhelming system`
  })
  @ApiParam({ name: 'name', description: 'Collection name', type: String })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Collection refresh queued successfully.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Collection not found or empty.' })
  @HttpCode(HttpStatus.CREATED)
  async refreshCollection(
    @Param('name') collectionName: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<{
    queued: number;
    requestId: string;
  }> {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User not authenticated');
    }

    // Get all wallets in collection
    const walletAddresses = await this.userFavoritesService.getWalletsInCollection(userId, collectionName);

    if (walletAddresses.length === 0) {
      throw new NotFoundException(`Collection '${collectionName}' not found or empty`);
    }

    // Limit to configured max
    const limitedWallets = walletAddresses.slice(0, USER_FAVORITES_CONFIG.COLLECTION_REFRESH_LIMIT);
    const scope: DashboardAnalysisScope = 'flash';
    const scopeDefaults = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS[scope];
    const requestId = `collection-refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    // Queue all wallets with LOW priority
    const jobs = await Promise.all(
      limitedWallets.map(walletAddress => {
        const jobData: DashboardWalletAnalysisJobData = {
          walletAddress,
          userId,
          requestId,
          analysisScope: scope,
          triggerSource: 'system',
          targetSignatureCount: scopeDefaults.targetSignatureCount,
          forceRefresh: false, // Let processor check freshness
          queueWorkingAfter: false,
          queueDeepAfter: false,
        };
        return this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
          priority: JobPriority.LOW,
          delay: 0,
        });
      })
    );

    return {
      queued: jobs.length,
      requestId,
    };
  }
}
