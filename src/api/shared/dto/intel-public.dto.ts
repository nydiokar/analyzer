import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WalletHudDto } from './wallet-hud.dto';
import { TokenPerformanceDataDto } from './token-performance-data.dto';

export class IntelWalletSummaryDto {
  @ApiProperty()
  lastAnalyzedAt: string;

  @ApiProperty()
  realizedPnl: number;

  @ApiProperty()
  profitableTradesCount: number;

  @ApiProperty()
  totalTradesCount: number;

  @ApiProperty({ nullable: true })
  currentSolBalance: number | null;

  @ApiProperty({ nullable: true })
  knownType: string | null;

  @ApiProperty({ nullable: true })
  knownLabel: string | null;
}

export class IntelKolIdentityDto {
  @ApiProperty()
  name: string;

  @ApiProperty({ nullable: true })
  twitter: string | null;

  @ApiProperty({ nullable: true })
  telegram: string | null;
}

export class IntelWalletBehaviorDto {
  @ApiProperty({ nullable: true })
  tradingStyle: string | null;

  @ApiProperty({ nullable: true })
  speedCategory: string | null;

  @ApiProperty({ nullable: true })
  avgHoldTimeHours: number | null;

  @ApiProperty({ nullable: true })
  medianHoldTimeHours: number | null;

  @ApiProperty({ nullable: true, description: 'Median time currently-held tokens have been held so far (not a completed-cycle metric)' })
  currentHoldMedianHours: number | null;

  @ApiProperty({ nullable: true })
  buySellRatio: number | null;

  @ApiProperty({ nullable: true })
  exitPattern: string | null;

  @ApiProperty({ nullable: true })
  avgEntryMcapUsd: number | null;

  @ApiProperty({ nullable: true })
  typicalEntryMcapUsd: number | null;

  @ApiProperty({ nullable: true })
  entryMcapP25Usd: number | null;

  @ApiProperty({ nullable: true })
  entryMcapP75Usd: number | null;

  @ApiProperty({ nullable: true })
  dominantEntryMcapBucket: string | null;

  @ApiProperty({ nullable: true })
  dominantEntryMcapBucketShare: number | null;
}

export class IntelPnlAllTimeDto {
  @ApiProperty()
  realizedPnlSol: number;

  @ApiProperty()
  unrealizedPnlSol: number;

  @ApiProperty()
  netPnlSol: number;

  @ApiProperty()
  winRate: number;
}

export class IntelPnlDto {
  @ApiPropertyOptional({ type: () => IntelPnlAllTimeDto, nullable: true })
  allTime: IntelPnlAllTimeDto | null;

  @ApiPropertyOptional({
    nullable: true,
    type: 'object',
    additionalProperties: true,
  })
  period: Record<string, unknown> | null;
}

export class IntelWalletProfileResponseDto {
  @ApiProperty({ enum: ['ok'] })
  status: 'ok';

  @ApiProperty()
  walletAddress: string;

  @ApiProperty({ type: () => IntelWalletSummaryDto })
  summary: IntelWalletSummaryDto;

  @ApiPropertyOptional({ type: () => IntelKolIdentityDto, nullable: true })
  kol: IntelKolIdentityDto | null;

  @ApiPropertyOptional({ type: () => WalletHudDto, nullable: true })
  hud: WalletHudDto | null;

  @ApiPropertyOptional({ type: () => IntelWalletBehaviorDto, nullable: true })
  behavior: IntelWalletBehaviorDto | null;

  @ApiPropertyOptional({ type: () => IntelPnlDto, nullable: true })
  pnl: IntelPnlDto | null;
}

export class IntelWalletQueuedResponseDto {
  @ApiProperty({ enum: ['queued'] })
  status: 'queued';

  @ApiProperty()
  walletAddress: string;

  @ApiProperty()
  jobId: string;

  @ApiPropertyOptional()
  prepaidJobId?: string;

  @ApiProperty({ nullable: true })
  monitoringUrl: string | null;

  @ApiProperty()
  message: string;
}

export class IntelSimilarWalletDto {
  @ApiProperty()
  walletAddress: string;

  @ApiProperty()
  distance: number;

  @ApiProperty()
  builtAt: string;

  @ApiProperty({ required: false, description: 'Cosine similarity (1 - distance). Present when rerank=true.' })
  cosineSimilarity?: number;

  @ApiProperty({ required: false, description: 'Count of tokens shared with the seed wallet. Present when rerank=true.' })
  sharedTokenCount?: number;

  @ApiProperty({ required: false, description: 'Jaccard overlap of traded tokens vs the seed wallet. Present when rerank=true.' })
  sharedTokenJaccard?: number;

  @ApiProperty({ required: false, description: 'Blended rank score = cosineSimilarity + tokenBoost * sharedTokenJaccard. Present when rerank=true.' })
  blendedScore?: number;
}

export class IntelSimilarWalletsResponseDto {
  @ApiProperty({ enum: ['ok'] })
  status: 'ok';

  @ApiProperty()
  walletAddress: string;

  @ApiProperty()
  schemaVersion: number;

  @ApiProperty()
  builtAt: string;

  @ApiProperty({ type: () => [IntelSimilarWalletDto] })
  neighbors: IntelSimilarWalletDto[];
}

export class IntelClusterMemberDto {
  @ApiProperty()
  walletAddress: string;

  @ApiProperty({ nullable: true })
  role: string | null;

  @ApiProperty()
  refreshedAt: string;
}

export class IntelClusterEdgeDto {
  @ApiProperty()
  a: string;

  @ApiProperty()
  b: string;

  @ApiProperty()
  sharedNonObvious: number;

  @ApiProperty()
  syncEventCount: number;

  @ApiProperty()
  score: number;

  @ApiProperty()
  refreshedAt: string;
}

export class IntelWalletClusterResponseDto {
  @ApiProperty({ enum: ['ok'] })
  status: 'ok';

  @ApiProperty()
  walletAddress: string;

  @ApiProperty()
  clusterId: string;

  @ApiProperty({ nullable: true })
  role: string | null;

  @ApiProperty()
  clusterSize: number;

  @ApiProperty()
  refreshedAt: string;

  @ApiProperty({ type: () => [IntelClusterMemberDto] })
  members: IntelClusterMemberDto[];

  @ApiProperty({ type: () => [IntelClusterEdgeDto] })
  topEdges: IntelClusterEdgeDto[];
}

export class IntelJobRefDto {
  @ApiProperty()
  jobId: string;

  @ApiProperty()
  requestId: string;

  @ApiProperty()
  monitoringUrl: string;

  @ApiPropertyOptional()
  resultKey?: string;
}

export class IntelQueuedResponseDto {
  @ApiProperty({ enum: ['queued'] })
  status: 'queued';

  @ApiProperty()
  jobId: string;

  @ApiProperty()
  requestId: string;

  @ApiProperty()
  monitoringUrl: string;
}

export class IntelHolderProfilesJobAcceptedResponseDto extends IntelQueuedResponseDto {
  @ApiProperty()
  tokenMint: string;

  @ApiProperty()
  topN: number;

  @ApiProperty()
  resultKey: string;

  @ApiProperty()
  message: string;
}

export class IntelSimilarityJobAcceptedResponseDto extends IntelQueuedResponseDto {
  @ApiProperty()
  walletCount: number;

  @ApiProperty()
  resultKey: string;

  @ApiProperty()
  message: string;
}

export class IntelHolderProfilesAgentJobAcceptedResponseDto extends IntelHolderProfilesJobAcceptedResponseDto {
  @ApiProperty()
  agentResultKey: string;
}

export class IntelSimilarityAgentJobAcceptedResponseDto extends IntelSimilarityJobAcceptedResponseDto {
  @ApiProperty()
  agentResultKey: string;
}

export class IntelDeepSimilarityRefDto {
  @ApiProperty({ type: String, nullable: true, example: null })
  jobId: string | null;

  @ApiProperty()
  requestId: string;

  @ApiProperty()
  resultKey: string;

  @ApiProperty()
  message: string;
}

export class IntelDeepJobAcceptedResponseDto {
  @ApiProperty({ enum: ['queued'] })
  status: 'queued';

  @ApiProperty()
  tokenMint: string;

  @ApiProperty()
  topN: number;

  @ApiProperty({ type: () => IntelJobRefDto })
  holderProfiles: IntelJobRefDto;

  @ApiProperty({ type: () => IntelDeepSimilarityRefDto })
  similarity: IntelDeepSimilarityRefDto;

  @ApiProperty()
  message: string;
}

export class IntelBatchHudQueuedEntryDto {
  @ApiProperty()
  walletAddress: string;

  @ApiProperty()
  jobId: string;

  @ApiProperty()
  monitoringUrl: string;
}

export class IntelBatchHudResponseDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: {
      $ref: '#/components/schemas/WalletHudDto',
    },
  })
  huds: Record<string, WalletHudDto>;

  @ApiProperty({ type: () => [IntelBatchHudQueuedEntryDto] })
  queued: IntelBatchHudQueuedEntryDto[];

  @ApiProperty({ type: [String] })
  skipped: string[];

  @ApiProperty()
  calculatedAt: Date;
}

export class IntelTokenPerformanceResponseDto {
  @ApiProperty({ type: () => [TokenPerformanceDataDto] })
  data: TokenPerformanceDataDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;

  @ApiProperty()
  totalPages: number;
}
