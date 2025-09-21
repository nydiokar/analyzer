import { Controller, Post, Body, ValidationPipe, Logger, Req, ForbiddenException, Get, Param, Query, UsePipes } from '@nestjs/common';
import { TokenInfoService } from '../services/token-info.service';
import { GetTokenInfoRequestDto } from '../shared/dto/get-token-info.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Request } from 'express';
import { TokenHoldersService } from '../services/token-holders.service';
import { SolanaAddressPipe } from '../shared/solana-address.pipe';
import { TopHoldersResponseDto } from '../shared/dto/top-holders.dto';

@ApiTags('token-info')
@Controller('token-info')
export class TokenInfoController {
  private readonly logger = new Logger(TokenInfoController.name);

  constructor(
    private readonly tokenInfoService: TokenInfoService,
    private readonly tokenHoldersService: TokenHoldersService,
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
    this.logger.log(`Received request to fetch info for ${body.tokenAddresses.length} tokens.`);
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User could not be identified.');
    }

    // This is a fire-and-forget operation.
    // It triggers enrichment for any new or stale tokens in the background.
    this.tokenInfoService.triggerTokenInfoEnrichment(body.tokenAddresses, userId);
    
    // Immediately return whatever data we have in the database right now.
    const records = await this.tokenInfoService.findMany(body.tokenAddresses);
    // Convert BigInt fields to JSON-safe values
    return records.map((t: any) => ({
      ...t,
      pairCreatedAt: t?.pairCreatedAt != null ? Number(t.pairCreatedAt) : null,
    }));
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