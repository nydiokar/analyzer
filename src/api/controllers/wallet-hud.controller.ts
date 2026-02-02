import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  HttpStatus,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBody,
} from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { WalletHudService } from '../services/wallet-hud.service';
import {
  WalletHudDto,
  BatchWalletHudRequestDto,
  BatchWalletHudResponseDto,
} from '../shared/dto/wallet-hud.dto';
import { Public } from '../shared/decorators/public.decorator';

/**
 * Controller for Wallet HUD (Heads-Up Display) endpoints.
 *
 * Provides high-signal, at-a-glance wallet metrics optimized for:
 * - Trackers page (batch fetching)
 * - Wallet profiles (single wallet, expanded view)
 * - Discovery and search results (compact inline)
 * - Holder analysis tools
 *
 * Design Philosophy: Like a poker HUD - maximum signal density, instant comprehension.
 */
@ApiTags('Wallet HUD')
@Controller('wallets')
@Public() // HUD data is public-facing for now (same as wallet summaries)
export class WalletHudController {
  constructor(private readonly walletHudService: WalletHudService) {}

  /**
   * Get HUD data for a single wallet
   *
   * Returns 6 core metrics + conditional badges for at-a-glance evaluation:
   * - Trimmed Mean PNL (outliers removed)
   * - Median P/L per Token
   * - Behavior Category (single-letter code)
   * - Avg Trades/Day
   * - Win Rate
   * - Data Quality Tier (GOLD/SILVER/BRONZE/INSUFFICIENT)
   * - Bot Badge (if detected)
   * - Whale Badge (if detected)
   */
  @Get(':address/hud')
  @ApiOperation({
    summary: 'Get HUD metrics for a wallet',
    description: `Returns high-signal metrics for at-a-glance wallet evaluation.

**Core Metrics (always shown):**
- Trimmed Mean PNL: Average P/L per token with outliers removed
- Median P/L per Token: True center of distribution
- Behavior Code: Single-letter trading pattern (M/F/H/A/I/S/?)
- Avg Trades/Day: Activity intensity
- Win Rate: Success percentage (0-1 decimal)
- Data Quality Tier: GOLD/SILVER/BRONZE/INSUFFICIENT

**Conditional Badges (only when applicable):**
- 🤖 Bot: Detected if trading > 60 unique tokens/day
- 🐋 Whale: Detected if holdings > 200 SOL OR > $20k USD

**Data Quality Tiers:**
- GOLD: 50+ trades, 7+ days active, complete data
- SILVER: 20+ trades, 3+ days active, good data
- BRONZE: 5+ trades, basic data
- INSUFFICIENT: Not enough data for reliable metrics`,
  })
  @ApiParam({
    name: 'address',
    description: 'The Solana wallet address',
    example: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'HUD data retrieved successfully',
    type: WalletHudDto,
  })
  @ApiResponse({
    status: HttpStatus.NOT_FOUND,
    description: 'Wallet not found or has insufficient data',
  })
  async getHud(@Param('address') address: string): Promise<WalletHudDto> {
    const hud = await this.walletHudService.getHud(address);

    if (!hud) {
      throw new NotFoundException(
        `Wallet ${address} not found or has insufficient data for HUD`,
      );
    }

    return hud;
  }

  /**
   * Get HUD data for multiple wallets (batch operation)
   *
   * Returns a map indexed by wallet address for O(1) lookup.
   * Critical for multi-wallet views (trackers, discovery, holder analysis).
   *
   * Performs a single optimized database query for all wallets.
   *
   * Rate Limit: 100 requests per 10 minutes per IP
   * Max wallets per request: 200
   */
  @Post('hud/batch')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 100, ttl: 600000 } }) // 100 requests per 10 minutes
  @ApiOperation({
    summary: 'Get HUD metrics for multiple wallets (batch)',
    description: `Batch fetch HUD data for multiple wallets in a single request.

**Critical for:**
- Trackers page (all favorite wallets)
- Discovery results (filtered wallet lists)
- Holder analysis (top holders)
- Search results (multiple wallet matches)

**Limits:**
- Max 200 wallets per request
- Rate limit: 100 requests per 10 minutes

**Performance:**
- Single optimized database query for all wallets
- 60-second Redis cache per wallet
- Returns map indexed by wallet address for O(1) lookup
- Includes 'notFound' array for wallets with insufficient data

**Example Response Structure:**
\`\`\`json
{
  "huds": {
    "wallet1": { ...hudData },
    "wallet2": { ...hudData }
  },
  "notFound": ["wallet3"],
  "calculatedAt": "2026-02-02T10:30:00.000Z"
}
\`\`\``,
  })
  @ApiBody({ type: BatchWalletHudRequestDto })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Batch HUD data retrieved successfully',
    type: BatchWalletHudResponseDto,
  })
  @ApiResponse({
    status: HttpStatus.BAD_REQUEST,
    description: 'Invalid request (empty array, too many wallets, etc.)',
  })
  @ApiResponse({
    status: HttpStatus.TOO_MANY_REQUESTS,
    description: 'Rate limit exceeded (100 requests per 10 minutes)',
  })
  async getHudBatch(
    @Body() batchRequest: BatchWalletHudRequestDto,
  ): Promise<BatchWalletHudResponseDto> {
    const { walletAddresses } = batchRequest;

    // Validation: empty array
    if (!walletAddresses || walletAddresses.length === 0) {
      // Return empty result for empty input (not an error)
      return {
        huds: {},
        notFound: [],
        calculatedAt: new Date(),
      };
    }

    // Validation: max array size
    const MAX_WALLETS_PER_REQUEST = 200;
    if (walletAddresses.length > MAX_WALLETS_PER_REQUEST) {
      throw new BadRequestException(
        `Too many wallets requested. Maximum ${MAX_WALLETS_PER_REQUEST} wallets per request. Requested: ${walletAddresses.length}`,
      );
    }

    return this.walletHudService.getHudBatch(walletAddresses);
  }
}
