import { Controller, Get, Header, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DiscoverService } from '../services/discover.service';
import {
  DiscoverWalletsQueryDto,
  DiscoverWalletsResponseDto,
  DiscoverAggregationResponseDto,
} from '../shared/dto/discover-wallet.dto';

@ApiTags('Discover')
@Controller('discover')
export class DiscoverController {
  constructor(private readonly discoverService: DiscoverService) {}

  @Get('wallets')
  @Header('Cache-Control', 'public, max-age=120')
  @ApiOperation({
    summary: 'Discover interesting wallets using cached analytics snapshots.',
    description:
      'Returns a lightweight, paginated list of wallets with explainable reasons based on existing PnL summaries and behavior profiles.',
  })
  @ApiResponse({ status: 200, type: DiscoverWalletsResponseDto })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getDiscoverWallets(
    @Query() query: DiscoverWalletsQueryDto,
  ): Promise<DiscoverWalletsResponseDto> {
    return this.discoverService.getDiscoverWallets(query);
  }

  @Get('aggregation')
  @Header('Cache-Control', 'public, max-age=120')
  @ApiOperation({
    summary: 'Get aggregated distribution stats for filtered discover wallets.',
    description:
      'Returns speed category and flow pattern distribution with PnL data for the entire filtered dataset (not paginated).',
  })
  @ApiResponse({ status: 200, type: DiscoverAggregationResponseDto })
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async getDiscoverAggregation(@Query() query: DiscoverWalletsQueryDto): Promise<DiscoverAggregationResponseDto> {
    return this.discoverService.getDiscoverAggregation(query);
  }
}
