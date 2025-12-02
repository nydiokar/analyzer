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

  // Onchain metadata fields
  @ApiProperty({ description: 'Token name from onchain metadata', type: String, nullable: true, required: false })
  onchainName?: string | null;

  @ApiProperty({ description: 'Token symbol from onchain metadata', type: String, nullable: true, required: false })
  onchainSymbol?: string | null;

  @ApiProperty({ description: 'Token image URL from onchain metadata', type: String, nullable: true, required: false })
  onchainImageUrl?: string | null;

  @ApiProperty({ description: 'Token website URL from onchain metadata', type: String, nullable: true, required: false })
  onchainWebsiteUrl?: string | null;

  @ApiProperty({ description: 'Token Twitter URL from onchain metadata', type: String, nullable: true, required: false })
  onchainTwitterUrl?: string | null;

  @ApiProperty({ description: 'Token Telegram URL from onchain metadata', type: String, nullable: true, required: false })
  onchainTelegramUrl?: string | null;

  // DexScreener market data for enhanced spam detection
  @ApiProperty({ description: 'Market capitalization in USD', type: Number, nullable: true, required: false })
  marketCapUsd?: number | null;

  @ApiProperty({ description: 'Liquidity in USD', type: Number, nullable: true, required: false })
  liquidityUsd?: number | null;

  @ApiProperty({ description: 'Unix timestamp when the trading pair was created', type: Number, nullable: true, required: false })
  pairCreatedAt?: number | null;

  @ApiProperty({ description: 'Fully diluted value', type: Number, nullable: true, required: false })
  fdv?: number | null;

  @ApiProperty({ description: '24h trading volume', type: Number, nullable: true, required: false })
  volume24h?: number | null;

  @ApiProperty({ description: 'Current price in USD (string to preserve precision)', type: String, nullable: true, required: false })
  priceUsd?: string | null;

  @ApiProperty({ description: 'When DexScreener data was last updated', type: String, format: 'date-time', nullable: true, required: false })
  dexscreenerUpdatedAt?: string | null;

  // Unrealized P&L calculations for current holdings
  @ApiProperty({ description: 'Current value of holdings in USD (currentUiBalance * priceUsd)', type: Number, nullable: true, required: false })
  currentHoldingsValueUsd?: number | null;

  @ApiProperty({ description: 'Current value of holdings in SOL (currentHoldingsValueUsd / realTimeSolPrice)', type: Number, nullable: true, required: false })
  currentHoldingsValueSol?: number | null;

  @ApiProperty({ description: 'Unrealized profit/loss in USD for current holdings', type: Number, nullable: true, required: false })
  unrealizedPnlUsd?: number | null;

  @ApiProperty({ description: 'Unrealized profit/loss in SOL for current holdings', type: Number, nullable: true, required: false })
  unrealizedPnlSol?: number | null;

  @ApiProperty({ description: 'Total P&L including both realized and unrealized (netSolProfitLoss + unrealizedPnlSol)', type: Number, nullable: true, required: false })
  totalPnlSol?: number | null;

  // PNL breakdown and percentage indicators
  @ApiProperty({ description: 'Realized profit/loss in SOL from tokens already sold', type: Number, nullable: true, required: false })
  realizedPnlSol?: number | null;

  @ApiProperty({ description: 'Realized P&L as percentage of total SOL invested (realizedPnlSol / totalSolSpent * 100)', type: Number, nullable: true, required: false })
  realizedPnlPercentage?: number | null;

  @ApiProperty({ description: 'Unrealized P&L as percentage of cost basis for current holdings', type: Number, nullable: true, required: false })
  unrealizedPnlPercentage?: number | null;

  // Spam risk analysis (pre-computed server-side to avoid heavy client processing)
  @ApiProperty({
    description: 'Categorical spam risk level derived from token activity heuristics',
    enum: ['safe', 'high-risk'],
    nullable: true,
    required: false,
  })
  spamRiskLevel?: 'safe' | 'high-risk' | null;

  @ApiProperty({
    description: 'Spam risk score between 0-100 (higher is riskier)',
    type: Number,
    nullable: true,
    required: false,
  })
  spamRiskScore?: number | null;

  @ApiProperty({
    description: 'List of reasons contributing to the spam risk score',
    type: [String],
    nullable: true,
    required: false,
  })
  spamRiskReasons?: string[] | null;

  @ApiProperty({
    description: 'Primary reason flagged for the spam risk score',
    type: String,
    nullable: true,
    required: false,
  })
  spamPrimaryReason?: string | null;

  // Note: The 'id' field from AnalysisResult is typically not exposed in API responses unless specifically needed.
}
