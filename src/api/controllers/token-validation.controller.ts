import { Controller, Get, Param, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@ApiTags('token-validation')
@Controller('token-validation')
export class TokenValidationController {
  private readonly logger = new Logger(TokenValidationController.name);

  constructor(private readonly httpService: HttpService) {}

  @Get(':address')
  @ApiOperation({ summary: 'Validate if a token address exists on Solana (via DexScreener)' })
  @ApiResponse({ status: 200, description: 'Returns validation result' })
  @ApiResponse({ status: 404, description: 'Token not found' })
  async validateToken(@Param('address') address: string) {
    try {
      // Call DexScreener API to check if token exists
      const url = `https://api.dexscreener.com/latest/dex/tokens/${address}`;

      const response = await firstValueFrom(
        this.httpService.get(url, {
          timeout: 5000,
          headers: { 'User-Agent': 'SovaIntel/1.0' },
        })
      );

      const data = response.data;

      // Check if we got valid pairs back
      if (!data || !data.pairs || data.pairs.length === 0) {
        return {
          valid: false,
          error: 'Token not found on DexScreener',
        };
      }

      // Token exists - return basic info
      const firstPair = data.pairs[0];
      return {
        valid: true,
        token: {
          address,
          symbol: firstPair.baseToken?.symbol || null,
          name: firstPair.baseToken?.name || null,
          hasLiquidity: !!firstPair.liquidity?.usd,
        },
      };
    } catch (error) {
      this.logger.error(`Token validation failed for ${address}:`, error);

      // If it's a 404 or timeout, token doesn't exist
      if (error.response?.status === 404 || error.code === 'ECONNABORTED') {
        return {
          valid: false,
          error: 'Token not found on Solana',
        };
      }

      // Other errors
      return {
        valid: false,
        error: 'Validation failed - please try again',
      };
    }
  }
}
