import { IsString, IsOptional, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class DashboardAnalysisRequestDto {
  @ApiProperty({
    description: 'The Solana wallet address to analyze',
    example: '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'
  })
  @IsString()
  walletAddress: string;
  
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
}

export class DashboardAnalysisResponseDto {
  @ApiProperty({ description: 'Unique job identifier for tracking' })
  jobId: string;
  
  @ApiProperty({ description: 'Request identifier for this analysis' })
  requestId: string;
  
  @ApiProperty({ description: 'Initial job status', enum: ['queued'] })
  status: string;
  
  @ApiProperty({ description: 'Queue name', example: 'analysis-operations' })
  queueName: string;
  
  @ApiProperty({ description: 'Estimated processing time' })
  estimatedProcessingTime: string;
  
  @ApiProperty({ description: 'URL to monitor job status' })
  monitoringUrl: string;
} 