import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsString,
  IsOptional,
  IsDateString,
  IsArray,
  IsBoolean,
  IsInt,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import {
  DASHBOARD_ANALYSIS_SCOPES,
  DASHBOARD_TRIGGER_SOURCES,
  DashboardAnalysisScope,
  DashboardAnalysisTriggerSource,
} from '../../../shared/dashboard-analysis.types';

export class JobStatusResponseDto {
  @ApiProperty({ description: 'Unique job identifier' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Job name/type' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Queue name' })
  @IsString()
  queue: string;

  @ApiProperty({ 
    description: 'Current job status',
    enum: ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused']
  })
  @IsEnum(['waiting', 'active', 'completed', 'failed', 'delayed', 'paused'])
  status: string;

  @ApiProperty({ 
    description: 'Job progress (number or object)',
    oneOf: [{ type: 'number' }, { type: 'object' }]
  })
  progress: number | object;

  @ApiProperty({ description: 'Job input data' })
  data: any;

  @ApiProperty({ description: 'Job result (if completed)', required: false })
  @IsOptional()
  result?: any;

  @ApiProperty({ description: 'Error message (if failed)', required: false })
  @IsOptional()
  @IsString()
  error?: string;

  @ApiProperty({ description: 'Job creation timestamp' })
  @IsDateString()
  createdAt: Date;

  @ApiProperty({ description: 'Job processing start timestamp', required: false })
  @IsOptional()
  @IsDateString()
  processedAt?: Date;

  @ApiProperty({ description: 'Job completion timestamp', required: false })
  @IsOptional()
  @IsDateString()
  finishedAt?: Date;

  @ApiProperty({ description: 'Number of attempts made' })
  @IsNumber()
  attempts: number;

  @ApiProperty({ description: 'Maximum attempts allowed' })
  @IsNumber()
  maxAttempts: number;

  @ApiProperty({ description: 'Remaining time until job starts (for delayed jobs)', required: false })
  @IsOptional()
  @IsNumber()
  remainingTime?: number;
}

export class QueueStatsResponseDto {
  @ApiProperty({ description: 'Queue name' })
  @IsString()
  queueName: string;

  @ApiProperty({ description: 'Number of waiting jobs' })
  @IsNumber()
  waiting: number;

  @ApiProperty({ description: 'Number of active jobs' })
  @IsNumber()
  active: number;

  @ApiProperty({ description: 'Number of completed jobs' })
  @IsNumber()
  completed: number;

  @ApiProperty({ description: 'Number of failed jobs' })
  @IsNumber()
  failed: number;

  @ApiProperty({ description: 'Number of delayed jobs' })
  @IsNumber()
  delayed: number;

  @ApiProperty({ description: 'Number of paused jobs' })
  @IsNumber()
  paused: number;
}

export class AllQueueStatsResponseDto {
  @ApiProperty({ 
    description: 'Statistics for all queues',
    type: [QueueStatsResponseDto]
  })
  queues: QueueStatsResponseDto[];

  @ApiProperty({ description: 'Total jobs across all queues' })
  @IsNumber()
  totalJobs: number;

  @ApiProperty({ description: 'Timestamp of the statistics' })
  @IsDateString()
  timestamp: string;
}

export class JobListResponseDto {
  @ApiProperty({ 
    description: 'List of jobs',
    type: [JobStatusResponseDto]
  })
  jobs: JobStatusResponseDto[];

  @ApiProperty({ description: 'Total number of jobs returned' })
  @IsNumber()
  total: number;

  @ApiProperty({ description: 'Limit applied to the query' })
  @IsNumber()
  limit: number;

  @ApiProperty({ description: 'Offset applied to the query' })
  @IsNumber()
  offset: number;
}

// === C2 Task: Job Submission DTOs ===

export class SyncWalletJobRequestDto {
  @ApiProperty({ description: 'Wallet address to sync' })
  @IsString()
  walletAddress: string;

  @ApiProperty({ description: 'Force refresh even if recently synced', required: false })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;

  @ApiProperty({ description: 'Fetch older transactions', required: false })
  @IsOptional()
  @IsBoolean()
  fetchOlder?: boolean;

  @ApiProperty({ description: 'Fetch all transactions', required: false })
  @IsOptional()
  @IsBoolean()
  fetchAll?: boolean;
}

export class AnalyzeWalletJobRequestDto {
  @ApiProperty({ description: 'Wallet address to analyze' })
  @IsString()
  walletAddress: string;

  @ApiProperty({ 
    description: 'Analysis types to perform',
    enum: ['pnl', 'behavior'],
    isArray: true
  })
  @IsArray()
  @IsEnum(['pnl', 'behavior'], { each: true })
  analysisTypes: ('pnl' | 'behavior')[];

  @ApiProperty({ description: 'Force refresh even if recently analyzed', required: false })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
}

export class SimilarityAnalysisJobRequestDto {
  @ApiProperty({ 
    description: 'Array of wallet addresses to analyze',
    type: [String],
    minItems: 2
  })
  @IsArray()
  @IsString({ each: true })
  walletAddresses: string[];

  @ApiProperty({ 
    description: 'Vector type for similarity calculation',
    enum: ['capital', 'binary'],
    required: false,
    default: 'capital'
  })
  @IsOptional()
  @IsEnum(['capital', 'binary'])
  vectorType?: 'capital' | 'binary';

  @ApiProperty({ description: 'Failure threshold (0-1)', required: false, default: 0.8 })
  @IsOptional()
  @IsNumber()
  failureThreshold?: number;

  @ApiProperty({ description: 'Timeout in minutes', required: false, default: 30 })
  @IsOptional()
  @IsNumber()
  timeoutMinutes?: number;
}

export class DashboardAnalysisJobRequestDto {
  @ApiProperty({ description: 'Wallet address to analyze for dashboard display' })
  @IsString()
  walletAddress: string;

  @ApiProperty({ description: 'Requested analysis scope', required: false, enum: DASHBOARD_ANALYSIS_SCOPES, default: 'deep' })
  @IsOptional()
  @IsEnum(DASHBOARD_ANALYSIS_SCOPES)
  analysisScope?: DashboardAnalysisScope;

  @ApiProperty({
    description: 'Trailing history window in days for scoped analyses',
    required: false,
    minimum: 1,
    maximum: 120,
  })
  @ValidateIf((o) => o.analysisScope && o.analysisScope !== 'deep')
  @IsInt()
  @Min(1)
  @Max(120)
  historyWindowDays?: number;

  @ApiProperty({
    description: 'Target signature count for scoped analyses',
    required: false,
    minimum: 50,
    maximum: 10000,
  })
  @IsOptional()
  @IsInt()
  @Min(50)
  @Max(10000)
  targetSignatureCount?: number;

  @ApiProperty({
    description: 'Source of the trigger (auto/manual/system)',
    required: false,
    enum: DASHBOARD_TRIGGER_SOURCES,
    default: 'manual',
  })
  @IsOptional()
  @IsEnum(DASHBOARD_TRIGGER_SOURCES)
  triggerSource?: DashboardAnalysisTriggerSource;

  @ApiProperty({ description: 'Force refresh even if recently analyzed', required: false, default: false })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;

  @ApiProperty({ description: 'Enable token metadata enrichment', required: false, default: true })
  @IsOptional()
  @IsBoolean()
  enrichMetadata?: boolean;

  @ApiProperty({
    description: 'Queue a working scope follow-up after completion',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  queueWorkingAfter?: boolean;

  @ApiProperty({
    description: 'Queue a deep scope follow-up after completion',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  queueDeepAfter?: boolean;

  @ApiProperty({ description: 'Timeout in minutes', required: false, default: 15 })
  @IsOptional()
  @IsNumber()
  timeoutMinutes?: number;
}

export class JobSubmissionResponseDto {
  @ApiProperty({ description: 'Unique job identifier' })
  @IsString()
  jobId: string;

  @ApiProperty({ description: 'Request identifier for tracking' })
  @IsString()
  requestId: string;

  @ApiProperty({ description: 'Initial job status', enum: ['queued'] })
  @IsEnum(['queued'])
  status: 'queued';

  @ApiProperty({ description: 'Queue name where job was added' })
  @IsString()
  queueName: string;

  @ApiProperty({ description: 'Analysis scope queued', required: false, enum: DASHBOARD_ANALYSIS_SCOPES })
  @IsOptional()
  @IsEnum(DASHBOARD_ANALYSIS_SCOPES)
  analysisScope?: DashboardAnalysisScope;

  @ApiProperty({ description: 'Estimated processing time' })
  @IsString()
  estimatedProcessingTime: string;

  @ApiProperty({ description: 'URL to monitor job status' })
  @IsString()
  monitoringUrl: string;
} 
