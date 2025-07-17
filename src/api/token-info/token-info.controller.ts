import { Controller, Post, Body, ValidationPipe, Logger, Req, ForbiddenException } from '@nestjs/common';
import { TokenInfoService } from './token-info.service';
import { GetTokenInfoRequestDto } from './dto/get-token-info.dto';
import { ApiTags, ApiOperation, ApiResponse, ApiBody } from '@nestjs/swagger';
import { Request } from 'express';

@ApiTags('token-info')
@Controller('token-info')
export class TokenInfoController {
  private readonly logger = new Logger(TokenInfoController.name);

  constructor(private readonly tokenInfoService: TokenInfoService) {}

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
    return this.tokenInfoService.findMany(body.tokenAddresses);
  }
} 