import { Controller, Post, Body, ValidationPipe, Logger, Req, ForbiddenException, HttpCode } from '@nestjs/common';
import { TokenInfoService } from '../services/token-info.service';
import { GetTokenInfoRequestDto } from '../shared/dto/get-token-info.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';

@ApiTags('token-info')
@Controller('token-info')
export class TokenInfoController {
  private readonly logger = new Logger(TokenInfoController.name);

  constructor(private readonly tokenInfoService: TokenInfoService) {}

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