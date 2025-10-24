import { IsString, IsOptional, IsBoolean, IsEnum, IsInt, Min, Max, ValidateIf, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  DASHBOARD_ANALYSIS_SCOPES,
  DashboardAnalysisScope,
  DASHBOARD_TRIGGER_SOURCES,
  DashboardAnalysisTriggerSource,
} from '../../../shared/dashboard-analysis.types';

export {
  DASHBOARD_ANALYSIS_SCOPES,
  DashboardAnalysisScope,
  DASHBOARD_TRIGGER_SOURCES,
  DashboardAnalysisTriggerSource,
} from '../../../shared/dashboard-analysis.types';

export class DashboardAnalysisRequestDto {
  @ApiProperty({
    description: 'The Solana wallet address to analyze',
    example: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  })
  @IsString()
  walletAddress: string;

  @ApiProperty({
    description: 'Requested analysis scope',
    required: false,
    enum: DASHBOARD_ANALYSIS_SCOPES,
    default: 'deep',
  })
  @IsOptional()
  @IsEnum(DASHBOARD_ANALYSIS_SCOPES, { message: `analysisScope must be one of: ${DASHBOARD_ANALYSIS_SCOPES.join(', ')}` })
  analysisScope?: DashboardAnalysisScope;

  @ApiProperty({
    description: 'Number of trailing days to include for scoped analyses',
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
  @IsEnum(DASHBOARD_TRIGGER_SOURCES, { message: `triggerSource must be one of: ${DASHBOARD_TRIGGER_SOURCES.join(', ')}` })
  triggerSource?: DashboardAnalysisTriggerSource;

  @ApiProperty({
    description: 'Force refresh even if wallet data is current',
    required: false,
    default: false
  })
  @IsOptional()
  @IsBoolean()
  forceRefresh?: boolean;
  
  @ApiProperty({
    description: 'Enable token metadata enrichment',
    required: false,
    default: true
  })
  @IsOptional()
  @IsBoolean()
  enrichMetadata?: boolean;

  @ApiProperty({
    description: 'Queue a working scope follow-up once this job completes',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  queueWorkingAfter?: boolean;

  @ApiProperty({
    description: 'Queue a deep scope follow-up once this job completes',
    required: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  queueDeepAfter?: boolean;

  @ApiProperty({
    description: 'Timeout in minutes',
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(240)
  timeoutMinutes?: number;
}

export class DashboardAnalysisResponseDto {
  @ApiProperty({ description: 'Unique job identifier for tracking', nullable: true })
  jobId: string | null;
  
  @ApiProperty({ description: 'Request identifier for this analysis' })
  requestId: string;
  
  @ApiProperty({ description: 'Initial job status', enum: ['queued'] })
  status: string;
  
  @ApiProperty({ description: 'Queue name', example: 'analysis-operations' })
  queueName: string;

  @ApiProperty({ description: 'Analysis scope that was requested', enum: DASHBOARD_ANALYSIS_SCOPES })
  analysisScope: DashboardAnalysisScope;
  
  @ApiProperty({ description: 'Estimated processing time' })
  estimatedProcessingTime: string;
  
  @ApiProperty({ description: 'URL to monitor job status' })
  monitoringUrl: string;

  @ApiProperty({
    description: 'Indicates the request was skipped due to freshness or policy',
    required: false,
  })
  @IsOptional()
  skipped?: boolean;

  @ApiProperty({
    description: 'Reason the request was skipped',
    required: false,
  })
  @IsOptional()
  skipReason?: string;

  @ApiProperty({
    description: 'Follow-up scopes that have been queued automatically',
    required: false,
    isArray: true,
    enum: DASHBOARD_ANALYSIS_SCOPES,
  })
  @IsOptional()
  @IsArray()
  queuedFollowUpScopes?: DashboardAnalysisScope[];
}
