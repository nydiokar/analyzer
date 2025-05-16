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

  // Note: The 'id' field from AnalysisResult is typically not exposed in API responses unless specifically needed.
} 