import { Controller, Post, Delete, Get, Param, Body, Req, HttpCode, HttpStatus, ForbiddenException, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AddFavoriteWalletDto } from '../../users/user-favorites.dto';
import { UserFavoritesService } from '../../users/user-favorites.service';
import { FavoriteWalletDetailDto } from '../../users/favorite-wallet-detail.dto';
import { User } from '@prisma/client';

// The AuthMiddleware in api.module.ts already protects routes starting with 'users'
// and populates req.user. No explicit @UseGuards(ApiKeyAuthGuard) needed here if middleware is global for the path.

interface AuthenticatedRequest extends Request {
  user: User; // Expect user to be populated by AuthMiddleware
}

@ApiTags('Users - Favorites')
@Controller('api/v1/users/:userId/favorites')
@ApiBearerAuth() // Indicates that API key authentication is expected (e.g., X-API-Key header)
export class UserFavoritesController {
  constructor(private readonly userFavoritesService: UserFavoritesService) {}

  private ensureUserAccess(requestingUser: User, targetUserId: string): void {
    if (requestingUser.id !== targetUserId) {
      // In a multi-user system with roles, you might allow admins to bypass this.
      // For now, users can only access their own favorites.
      throw new ForbiddenException('You are not authorized to access or modify favorites for this user.');
    }
  }

  @Post()
  @ApiOperation({ summary: "Add a wallet to the specified user's favorites" })
  @ApiParam({ name: 'userId', description: 'The ID of the user', type: String })
  @ApiBody({ type: AddFavoriteWalletDto })
  @ApiResponse({ status: HttpStatus.CREATED, description: 'Wallet added to favorites.' })
  @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid input.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized (API key missing or invalid).' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Forbidden (API key valid, but user mismatch).' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'User or Wallet not found.' })
  @ApiResponse({ status: HttpStatus.CONFLICT, description: 'Wallet already in favorites.' })
  @HttpCode(HttpStatus.CREATED)
  async addFavorite(
    @Param('userId') targetUserId: string,
    @Body() addFavoriteWalletDto: AddFavoriteWalletDto,
    @Req() req: AuthenticatedRequest, 
  ): Promise<void> {
    this.ensureUserAccess(req.user, targetUserId);
    return this.userFavoritesService.addFavorite(targetUserId, addFavoriteWalletDto.walletAddress);
  }

  @Delete(':walletAddress')
  @ApiOperation({ summary: "Remove a wallet from the specified user's favorites" })
  @ApiParam({ name: 'userId', description: 'The ID of the user', type: String })
  @ApiParam({ name: 'walletAddress', description: 'The wallet address to remove', type: String })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Wallet removed from favorites.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized (API key missing or invalid).' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Forbidden (API key valid, but user mismatch).' })
  @ApiResponse({ status: HttpStatus.NOT_FOUND, description: 'Favorite entry not found.' })
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeFavorite(
    @Param('userId') targetUserId: string,
    @Param('walletAddress') walletAddress: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<void> {
    this.ensureUserAccess(req.user, targetUserId);
    return this.userFavoritesService.removeFavorite(targetUserId, walletAddress);
  }

  @Get()
  @ApiOperation({ summary: "Get the specified user's favorite wallets" })
  @ApiParam({ name: 'userId', description: 'The ID of the user', type: String })
  @ApiResponse({ status: HttpStatus.OK, description: 'List of favorite wallets.', type: [FavoriteWalletDetailDto] })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized (API key missing or invalid).' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Forbidden (API key valid, but user mismatch).' })
  async getFavorites(
    @Param('userId') targetUserId: string,
    @Req() req: AuthenticatedRequest,
  ): Promise<FavoriteWalletDetailDto[]> {
    this.ensureUserAccess(req.user, targetUserId);
    return this.userFavoritesService.getFavorites(targetUserId);
  }
} 