import { Controller, Post, Delete, Get, Param, Body, Req, HttpCode, HttpStatus, UseGuards, Put } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AddFavoriteWalletDto, FavoriteWalletDetailDto, UpdateFavoriteWalletDto } from '../../users/favorite-wallet-detail.dto';
import { UserFavoritesService } from '../../users/user-favorites.service';
import { User } from '@prisma/client';
import { ApiKeyAuthGuard } from '../../auth/api-key-auth.guard';
import { Request } from 'express';

// Define the authenticated request interface
// The global ApiKeyAuthGuard protects all routes and populates req.user.

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('User Favorites')
@Controller('users/me/favorites')
@ApiBearerAuth()
export class UserFavoritesController {
  constructor(private readonly userFavoritesService: UserFavoritesService) {}

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
  ): Promise<void> {
    const userId = req.user!.id;
    return this.userFavoritesService.addFavorite(userId, addFavoriteWalletDto);
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
  ): Promise<void> {
    const userId = req.user!.id;
    return this.userFavoritesService.removeFavorite(userId, walletAddress);
  }

  @Put(':walletAddress')
  @ApiOperation({ summary: "Update a favorite wallet's metadata" })
  @ApiParam({ name: 'walletAddress', description: 'The wallet address to update', type: String })
  @ApiBody({ type: UpdateFavoriteWalletDto })
  @ApiResponse({ status: HttpStatus.OK, description: 'Favorite wallet updated successfully.' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Favorite wallet not found.' })
  async updateFavorite(
    @Param('walletAddress') walletAddress: string,
    @Body() updateFavoriteWalletDto: UpdateFavoriteWalletDto,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const userId = req.user!.id;
    return this.userFavoritesService.updateFavorite(userId, walletAddress, updateFavoriteWalletDto);
  }

  @Post(':walletAddress/viewed')
  @ApiOperation({ summary: "Mark a favorite wallet as viewed" })
  @ApiParam({ name: 'walletAddress', description: 'The wallet address that was viewed', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'Wallet view timestamp updated.' })
  @HttpCode(HttpStatus.OK)
  async markAsViewed(
    @Param('walletAddress') walletAddress: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    const userId = req.user!.id;
    return this.userFavoritesService.updateLastViewed(userId, walletAddress);
  }

  @Get()
  @ApiOperation({ summary: "Get the authenticated user's favorite wallets" })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of favorite wallets.', type: [FavoriteWalletDetailDto] })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized (API key missing or invalid).' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User (from API key) not found.'})
  async getFavorites(
    @Req() req: AuthenticatedRequest,
  ): Promise<FavoriteWalletDetailDto[]> {
    const userId = req.user!.id;
    return this.userFavoritesService.getFavorites(userId);
  }

  @Get('tags')
  @ApiOperation({ summary: "Get all unique tags used by the authenticated user" })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of unique tags.', type: [String] })
  async getUserTags(
    @Req() req: AuthenticatedRequest,
  ): Promise<string[]> {
    const userId = req.user!.id;
    return this.userFavoritesService.getUserTags(userId);
  }

  @Get('collections')
  @ApiOperation({ summary: "Get all unique collections used by the authenticated user" })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of unique collections.', type: [String] })
  async getUserCollections(
    @Req() req: AuthenticatedRequest,
  ): Promise<string[]> {
    const userId = req.user!.id;
    return this.userFavoritesService.getUserCollections(userId);
  }
} 