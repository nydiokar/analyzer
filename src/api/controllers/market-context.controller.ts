import { BadRequestException, Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MarketContextService } from '../services/market-context.service';
import {
  LatestSolPriceQueryDto,
  SolPriceDto,
  SolPriceRangeQueryDto,
  SolPriceRangeResponseDto,
} from '../shared/dto/sol-price.dto';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertDateKey(value: string, field: string): void {
  if (!DATE_RE.test(value)) {
    throw new BadRequestException(`${field} must use YYYY-MM-DD format.`);
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} must be a valid UTC calendar date.`);
  }
}

function dateDiffDays(from: string, to: string): number {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Math.floor((end - start) / 86_400_000);
}

function parseMaxAgeHours(value: string | undefined): number {
  if (value === undefined) return 48;

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 168) {
    throw new BadRequestException('maxAgeHours must be an integer between 1 and 168.');
  }

  return parsed;
}

@ApiTags('Market Context')
@Controller('market-context')
export class MarketContextController {
  constructor(private readonly marketContextService: MarketContextService) {}

  @Get('sol-price/latest')
  @ApiOperation({ summary: 'Get the latest stored SOL/USD daily price.' })
  @ApiQuery({ name: 'maxAgeHours', required: false, description: 'Maximum accepted age for the latest stored row.', example: 48 })
  @ApiResponse({ status: 200, description: 'Latest stored SOL/USD price.', type: SolPriceDto })
  @ApiResponse({ status: 404, description: 'No recent SOL/USD price is available.' })
  async getLatestSolPrice(@Query() query: LatestSolPriceQueryDto): Promise<SolPriceDto> {
    const maxAgeHours = parseMaxAgeHours(query.maxAgeHours);
    const row = await this.marketContextService.getLatestSolPrice(maxAgeHours);
    if (!row) {
      throw new NotFoundException(`No SOL/USD price found within the last ${maxAgeHours} hour(s).`);
    }

    return row;
  }

  @Get('sol-price/:date')
  @ApiOperation({ summary: 'Get the stored SOL/USD daily price for a UTC date.' })
  @ApiParam({ name: 'date', description: 'UTC calendar date in YYYY-MM-DD format.', example: '2026-06-13' })
  @ApiResponse({ status: 200, description: 'Stored SOL/USD price for the requested date.', type: SolPriceDto })
  @ApiResponse({ status: 404, description: 'No SOL/USD price is available for the requested date.' })
  async getSolPriceByDate(@Param('date') date: string): Promise<SolPriceDto> {
    assertDateKey(date, 'date');

    const row = await this.marketContextService.getSolPriceByDate(date);
    if (!row) {
      throw new NotFoundException(`No SOL/USD price found for ${date}.`);
    }

    return row;
  }

  @Get('sol-prices')
  @ApiOperation({ summary: 'Get stored SOL/USD daily prices for an inclusive UTC date range.' })
  @ApiResponse({ status: 200, description: 'Stored SOL/USD prices for the requested range.', type: SolPriceRangeResponseDto })
  async getSolPricesRange(@Query() query: SolPriceRangeQueryDto): Promise<SolPriceRangeResponseDto> {
    assertDateKey(query.from, 'from');
    assertDateKey(query.to, 'to');

    if (query.from > query.to) {
      throw new BadRequestException('from must be earlier than or equal to to.');
    }

    const rangeDays = dateDiffDays(query.from, query.to) + 1;
    const maxDays = this.marketContextService.getMaxSolPriceRangeDays();
    if (rangeDays > maxDays) {
      throw new BadRequestException(`Date range cannot exceed ${maxDays} days.`);
    }

    const prices = await this.marketContextService.getSolPricesRange(query.from, query.to);
    return {
      from: query.from,
      to: query.to,
      count: prices.length,
      prices,
    };
  }
}
