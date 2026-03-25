import { Controller, Post, Body, ValidationPipe, Logger, Req, ForbiddenException, Get, Param, Query, UsePipes, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { TokenInfoService } from '../services/token-info.service';
import { GetTokenInfoRequestDto } from '../shared/dto/get-token-info.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { TokenHoldersService } from '../services/token-holders.service';
import { SparklineService } from '../services/sparkline.service';
import { isValidSolanaAddress, SolanaAddressPipe } from '../shared/solana-address.pipe';
import { TopHoldersResponseDto } from '../shared/dto/top-holders.dto';

@ApiTags('token-info')
@Controller('token-info')
export class TokenInfoController {
  private readonly logger = new Logger(TokenInfoController.name);

  constructor(
    private readonly tokenInfoService: TokenInfoService,
    private readonly tokenHoldersService: TokenHoldersService,
    private readonly sparklineService: SparklineService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Get information for a list of tokens' })
  @ApiBody({ type: GetTokenInfoRequestDto })
  @ApiResponse({ status: 200, description: 'Returns a list of token information objects.'})
  @ApiResponse({ status: 400, description: 'Invalid input.' })
  @ApiResponse({ status: 403, description: 'Forbidden.' })
  async getTokenInfo(
    @Body(new ValidationPipe()) body: GetTokenInfoRequestDto,
    @Req() req: Request & { user?: any },
  ) {
    const validTokenAddresses = body.tokenAddresses.filter(isValidSolanaAddress);
    if (validTokenAddresses.length === 0) {
      return [];
    }

    this.logger.log(`Received request to fetch info for ${validTokenAddresses.length} tokens.`);
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User could not be identified.');
    }

    this.tokenInfoService.triggerTokenInfoEnrichment(validTokenAddresses, userId);
    
    // Immediately return whatever data we have in the database right now.
    const records = await this.tokenInfoService.findMany(validTokenAddresses);
    // Convert BigInt fields to JSON-safe values
    return records.map((t: any) => ({
      ...t,
      pairCreatedAt: t?.pairCreatedAt != null ? Number(t.pairCreatedAt) : null,
    }));
  }

  @Get(':mint/sparkline')
  async getSparkline(
    @Param('mint') mint: string,
    @Query('points') points?: string,
  ) {
    const n = Math.min(Math.max(parseInt(points ?? '24', 10) || 24, 1), 96);
    const data = await this.sparklineService.read(mint, n);
    return { points: data };
  }

  // New endpoint for top holders (reads only)
  @Get(':mint/top-holders')
  @UsePipes(new ValidationPipe({ transform: true }))
  @ApiOperation({ summary: 'Get top token holders for a specific token mint' })
  @ApiParam({ name: 'mint', description: 'Token mint address', example: 'So11111111111111111111111111111111111111112' })
  @ApiQuery({ name: 'commitment', required: false, description: 'RPC commitment (finalized|confirmed|processed)' })
  @ApiResponse({ status: 200, description: 'Top token holders returned.', type: TopHoldersResponseDto })
  async getTopHolders(
    @Param('mint', SolanaAddressPipe) mint: string,
    @Query('commitment') commitment?: string,
  ): Promise<TopHoldersResponseDto> {
    const result = await this.tokenHoldersService.getTopHolders(mint, commitment);
    return result;
  }
}
