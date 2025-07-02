import { Controller, Post, Delete, Get, Param, Body, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AddFavoriteWalletDto } from '../../users/user-favorites.dto';
import { UserFavoritesService } from '../../users/user-favorites.service';
import { FavoriteWalletDetailDto } from '../../users/favorite-wallet-detail.dto';
import { User } from '@prisma/client';

// The global ApiKeyAuthGuard protects all routes and populates req.user.

interface AuthenticatedRequest extends Request {
  user?: User; // user is optional as it's populated by the guard
}

@ApiTags('Users - Favorites')
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
    return this.userFavoritesService.addFavorite(userId, addFavoriteWalletDto.walletAddress);
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
} 