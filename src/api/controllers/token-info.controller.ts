import { Controller, Post, Body, ValidationPipe, Logger, Req, ForbiddenException, HttpCode, Get, Param, Query, Res, Headers } from '@nestjs/common';
import { TokenInfoService } from '../services/token-info.service';
import { GetTokenInfoRequestDto } from '../shared/dto/get-token-info.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';
import type { Response } from 'express';
import { SparklineService } from '../services/sparkline.service';

function createSimpleHash(s: string): string {
  // DJB2 variant for speed; adequate for ETag purposes
  let hash = 5381;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) + hash) ^ s.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash.toString(16);
}

@ApiTags('token-info')
@Controller('token-info')
export class TokenInfoController {
  private readonly logger = new Logger(TokenInfoController.name);

  constructor(private readonly tokenInfoService: TokenInfoService, private readonly sparklineService: SparklineService) {}

  @Post()
  @HttpCode(200)
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

    // Await enrichment so first-time tokens return usable data immediately.
    await this.tokenInfoService.triggerTokenInfoEnrichment(body.tokenAddresses, userId);
    // Return the latest data in the database.
    const rows = await this.tokenInfoService.findMany(body.tokenAddresses);
    // Ensure JSON-safe response (convert BigInt to string)
    const safe = JSON.parse(
      JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
    );
    return safe;
  }

  @Get(':addr/sparkline')
  @ApiOperation({ summary: 'Get sparkline points for a token address' })
  @ApiResponse({ status: 200, description: 'Returns compact sparkline series.' })
  async getSparkline(
    @Param('addr') addr: string,
    @Query('points') pointsQ: string | undefined,
    @Res() res: Response,
    @Headers('if-none-match') ifNoneMatch?: string,
  ) {
    const points = Math.min(Math.max(Number(pointsQ ?? '24'), 2), 96);
    try {
      const compact = await this.sparklineService.read(addr, points);
      res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=30');
      // Stronger ETag: simple hash of payload
      const payload = JSON.stringify(compact);
      const hash = createSimpleHash(payload);
      const etag = `W/"${hash}"`;
      if (ifNoneMatch && ifNoneMatch === etag) {
        return res.status(304).end();
      }
      res.setHeader('ETag', etag);
      return res.status(200).json({ points: compact });
    } catch (e) {
      this.logger.debug(`sparkline read failed for ${addr}: ${e instanceof Error ? e.message : String(e)}`);
      return res.status(200).json({ points: [] });
    }
  }

  @Post('batch')
  @HttpCode(200)
  async getTokenInfoBatch(@Body(new ValidationPipe()) body: GetTokenInfoRequestDto, @Req() req: Request & { user?: any }) {
    const userId = req.user?.id;
    if (!userId) {
      throw new ForbiddenException('User could not be identified.');
    }
    // Same behavior as main route
    this.tokenInfoService.triggerTokenInfoEnrichment(body.tokenAddresses, userId);
    const rows = await this.tokenInfoService.findMany(body.tokenAddresses);
    const safe = JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
    return safe;
  }
} 