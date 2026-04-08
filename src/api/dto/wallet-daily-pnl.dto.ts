import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, Matches } from 'class-validator';

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class WalletDailyPnlQueryDto {
  @ApiProperty({ description: 'Start date (YYYY-MM-DD)', example: '2026-03-01' })
  @IsNotEmpty()
  @Matches(ISO_DATE_PATTERN, { message: 'startDate must be a date in YYYY-MM-DD format' })
  startDate: string;

  @ApiProperty({ description: 'End date (YYYY-MM-DD)', example: '2026-03-31' })
  @IsNotEmpty()
  @Matches(ISO_DATE_PATTERN, { message: 'endDate must be a date in YYYY-MM-DD format' })
  endDate: string;
}

export class DailyPnlRowDto {
  @ApiProperty({ example: '2026-03-15' })
  date: string;

  @ApiProperty() tradeCount: number;
  @ApiProperty() buyCount: number;
  @ApiProperty() sellCount: number;
  @ApiProperty() volumeSol: number;
  @ApiProperty() feesSol: number;
  @ApiProperty() realizedPnlSol: number;
  @ApiProperty() profitableSellsCount: number;
  @ApiProperty() totalSellsCount: number;
  @ApiProperty({ description: 'Sell-event win rate for the day (null when no sells)' })
  winRate: number | null;
  @ApiProperty({ description: 'Distinct mints touched; not additive across days' })
  uniqueMintsTradedCount: number;
  @ApiPropertyOptional({ nullable: true }) volumeUsd: number | null;
  @ApiPropertyOptional({ nullable: true }) realizedPnlUsd: number | null;
  @ApiProperty() hasIncompleteEnrichment: boolean;
  @ApiProperty() hasIncompleteHistory: boolean;
}

export class DailyPnlSummaryDto {
  @ApiProperty() totalRealizedPnlSol: number;
  @ApiProperty() totalTradeCount: number;
  @ApiProperty() totalVolumeSol: number;
  @ApiProperty({ description: 'Sell-event win rate across the period (null when no sells)' })
  winRate: number | null;
  @ApiProperty() periodStart: string;
  @ApiProperty() periodEnd: string;
}

export class WalletDailyPnlResponseDto {
  @ApiProperty({
    description:
      'Realized PnL is attributed to the sell event\'s calendar day. ' +
      'A buy on day 1 + sell on day 8 appears in day 8\'s realizedPnlSol.',
    example: 'sell_date',
  })
  attributionMethod: 'sell_date';

  @ApiProperty({ type: [DailyPnlRowDto] })
  data: DailyPnlRowDto[];

  @ApiProperty({ type: DailyPnlSummaryDto })
  summary: DailyPnlSummaryDto;
}
