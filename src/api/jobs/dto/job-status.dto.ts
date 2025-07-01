import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsString, IsOptional, IsDateString } from 'class-validator';

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