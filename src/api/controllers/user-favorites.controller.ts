import { Controller, Post, Delete, Put, Get, Body, Param, Req, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { User } from '@prisma/client';
import { UserFavoritesService } from '../services/user-favorites.service';
import { AddFavoriteWalletDto, FavoriteWalletDetailDto, UpdateFavoriteWalletDto } from '../shared/dto/favorite-wallet-detail.dto';

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
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user!.id;
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
    @Res() res: Response,
  ): Promise<void> {
    const userId = req.user!.id;
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
    const userId = req.user!.id;
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