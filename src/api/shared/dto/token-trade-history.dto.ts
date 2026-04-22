import { ApiProperty } from '@nestjs/swagger';

export class TokenTradeItemDto {
  @ApiProperty({ description: 'Solana transaction signature', type: String })
  signature: string;

  @ApiProperty({ description: 'Unix timestamp (seconds) of the trade', type: Number })
  timestamp: number;

  @ApiProperty({ description: 'Trade direction', enum: ['buy', 'sell', 'transfer'] })
  direction: string;

  @ApiProperty({ description: 'Token units traded', type: Number })
  amount: number;

  @ApiProperty({ description: 'SOL in or out for this trade', type: Number })
  associatedSolValue: number;

  @ApiProperty({ description: 'Per-token USD price at trade time', type: Number, nullable: true, required: false })
  tokenPriceUsd: number | null;

  @ApiProperty({ description: 'Fully diluted market cap in USD at trade time', type: Number, nullable: true, required: false })
  marketCapUsd: number | null;

  @ApiProperty({ description: 'Market cap bucket at trade time', type: String, nullable: true, required: false })
  mcapBucket: string | null;

  @ApiProperty({ description: 'SOL fee paid for this transaction', type: Number, nullable: true, required: false })
  feeAmount: number | null;

  @ApiProperty({ description: 'ISO string when this row was enriched; null means not yet enriched', type: String, nullable: true, required: false })
  enrichedAt: string | null;
}

export class TokenTradeHistoryDto {
  @ApiProperty({ description: 'Wallet address', type: String })
  walletAddress: string;

  @ApiProperty({ description: 'Token mint address', type: String })
  tokenAddress: string;

  @ApiProperty({ description: 'Chronological list of trades for this wallet × token pair', type: [TokenTradeItemDto] })
  trades: TokenTradeItemDto[];

  @ApiProperty({ description: 'Volume-weighted avg market cap at entry', type: Number, nullable: true, required: false })
  avgEntryMcap: number | null;

  @ApiProperty({ description: 'Volume-weighted avg market cap at exit', type: Number, nullable: true, required: false })
  avgExitMcap: number | null;

  @ApiProperty({ description: 'Typical (median) entry market cap in USD', type: Number, nullable: true, required: false })
  typicalEntryMcapUsd: number | null;

  @ApiProperty({ description: '25th percentile entry market cap in USD', type: Number, nullable: true, required: false })
  entryMcapP25Usd: number | null;

  @ApiProperty({ description: '75th percentile entry market cap in USD', type: Number, nullable: true, required: false })
  entryMcapP75Usd: number | null;

  @ApiProperty({ description: 'Typical (median) exit market cap in USD', type: Number, nullable: true, required: false })
  typicalExitMcapUsd: number | null;

  @ApiProperty({ description: '25th percentile exit market cap in USD', type: Number, nullable: true, required: false })
  exitMcapP25Usd: number | null;

  @ApiProperty({ description: '75th percentile exit market cap in USD', type: Number, nullable: true, required: false })
  exitMcapP75Usd: number | null;
}
