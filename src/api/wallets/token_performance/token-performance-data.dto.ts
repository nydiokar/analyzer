import { ApiProperty } from '@nestjs/swagger';

export class TokenPerformanceDataDto {
  @ApiProperty({ description: 'Wallet address', example: '5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1' })
  walletAddress: string;

  @ApiProperty({ description: 'Token mint address', example: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' })
  tokenAddress: string;

  @ApiProperty({ description: "Total amount of the token received (sum of 'in' transfers)", type: Number })
  totalAmountIn: number;

  @ApiProperty({ description: "Total amount of the token sent (sum of 'out' transfers)", type: Number })
  totalAmountOut: number;

  @ApiProperty({ description: 'Net change in token balance (totalAmountIn - totalAmountOut)', type: Number })
  netAmountChange: number;

  @ApiProperty({ description: 'Gross SOL spent to acquire this token', type: Number })
  totalSolSpent: number;

  @ApiProperty({ description: 'Gross SOL received from selling this token', type: Number })
  totalSolReceived: number;

  @ApiProperty({ description: "Total explicit SOL fees paid related to this token's transactions", type: Number, nullable: true, required: false })
  totalFeesPaidInSol?: number | null;

  @ApiProperty({ description: 'Net profit or loss in SOL (totalSolReceived - totalSolSpent - totalFeesPaidInSol)', type: Number })
  netSolProfitLoss: number;

  @ApiProperty({ description: "Number of 'in' transfers for this token", type: Number })
  transferCountIn: number;

  @ApiProperty({ description: "Number of 'out' transfers for this token", type: Number })
  transferCountOut: number;

  @ApiProperty({ description: 'Unix timestamp (seconds) of the first transfer involving this token', type: Number, nullable: true, required: false })
  firstTransferTimestamp?: number | null;

  @ApiProperty({ description: 'Unix timestamp (seconds) of the last transfer involving this token', type: Number, nullable: true, required: false })
  lastTransferTimestamp?: number | null;

  // Fields for current token balance snapshot
  @ApiProperty({ description: 'Current raw token balance (string to preserve precision)', type: String, nullable: true, required: false })
  currentRawBalance?: string | null;

  @ApiProperty({ description: 'Current UI-friendly token balance', type: Number, nullable: true, required: false })
  currentUiBalance?: number | null;

  @ApiProperty({ description: 'Current UI-friendly token balance as a string', type: String, nullable: true, required: false })
  currentUiBalanceString?: string | null;

  @ApiProperty({ description: 'Decimals for the current balance fields', type: Number, nullable: true, required: false })
  balanceDecimals?: number | null;

  @ApiProperty({ description: 'Timestamp when this specific token balance was part of a WalletState fetch', type: String, format: 'date-time', nullable: true, required: false })
  balanceFetchedAt?: string | null; // Store as ISO string in DTO

  // Enriched data from TokenInfo
  @ApiProperty({ description: 'Token name', type: String, nullable: true, required: false })
  name?: string | null;

  @ApiProperty({ description: 'Token symbol', type: String, nullable: true, required: false })
  symbol?: string | null;

  @ApiProperty({ description: 'Token image URL', type: String, nullable: true, required: false })
  imageUrl?: string | null;

  @ApiProperty({ description: 'Token website URL', type: String, nullable: true, required: false })
  websiteUrl?: string | null;

  @ApiProperty({ description: 'Token Twitter URL', type: String, nullable: true, required: false })
  twitterUrl?: string | null;

  @ApiProperty({ description: 'Token Telegram URL', type: String, nullable: true, required: false })
  telegramUrl?: string | null;

  // Note: The 'id' field from AnalysisResult is typically not exposed in API responses unless specifically needed.
} 