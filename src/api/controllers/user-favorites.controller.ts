import { Controller, Post, Delete, Patch, Get, Body, Param, Req, HttpCode, HttpStatus, Res, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { User } from '@prisma/client';
import { UserFavoritesService } from '../services/user-favorites.service';
import { AddFavoriteWalletDto, FavoriteWalletDetailDto, UpdateFavoriteWalletDto } from '../shared/dto/favorite-wallet-detail.dto';
import { BulkImportFavoriteWalletsDto } from '../shared/dto/favorite-wallet-import.dto';
import { AnalysisOperationsQueue } from '../../queues/queues/analysis-operations.queue';
import type { DashboardWalletAnalysisJobData } from '../../queues/jobs/types';
import { JobPriority } from '../../queues/config/queue.config';
import { DASHBOARD_ANALYSIS_SCOPE_DEFAULTS, USER_FAVORITES_CONFIG } from '../../config/constants';

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
  @ApiOperation({ summary: 'Bulk import wallets into favorites (CSV/JSON compatible)' })
  @ApiBody({ type: BulkImportFavoriteWalletsDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Wallets imported successfully.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input.' })
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

    const walletsToAnalyze = createdWallets;
    const limit = Math.min(USER_FAVORITES_CONFIG.IMPORT_FLASH_BATCH, walletsToAnalyze.length);
    const scope = 'flash' as const;
    const flashTargetSignatures = DASHBOARD_ANALYSIS_SCOPE_DEFAULTS.flash.targetSignatureCount;
    const targetSignatureCount = Math.min(dto.targetSignatureCount ?? flashTargetSignatures, flashTargetSignatures);
    if (limit === 0) {
      return publicResult;
    }

    const requestId = `bulk-import-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const jobIds: string[] = [];
    const batchSize = 25;
    const targetWallets = walletsToAnalyze.slice(0, limit);

    for (let i = 0; i < targetWallets.length; i += batchSize) {
      const batch = targetWallets.slice(i, i + batchSize);
      const jobs = await Promise.all(
        batch.map(walletAddress => {
          const jobData: DashboardWalletAnalysisJobData = {
            walletAddress,
            userId,
            requestId,
            analysisScope: scope,
            triggerSource: 'system',
            targetSignatureCount,
            forceRefresh: dto.forceRefresh ?? false,
            queueWorkingAfter: false,
            queueDeepAfter: false,
          };
          return this.analysisOperationsQueue.addDashboardWalletAnalysisJob(jobData, {
            priority: JobPriority.LOW,
            delay: 0,
          });
        })
      );

      if (dto.includeJobIds) {
        jobs.forEach(job => {
          if (job.id) {
            jobIds.push(String(job.id));
          }
        });
      }
    }

    return {
      ...publicResult,
      analysisQueued: targetWallets.length,
      analysisRequestId: requestId,
      ...(dto.includeJobIds ? { analysisJobIds: jobIds } : {}),
    };
  }
}
