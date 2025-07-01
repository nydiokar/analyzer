import { Controller, Get, Param, Query, UseGuards, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { ApiKeyAuthGuard } from '../auth/api-key-auth.guard';
import { JobsService } from './jobs.service';
import { JobState } from 'bullmq';
import { 
  JobStatusResponseDto, 
  QueueStatsResponseDto, 
  AllQueueStatsResponseDto, 
  JobListResponseDto 
} from './dto/job-status.dto';

@ApiTags('Jobs')
@Controller('jobs')
@UseGuards(ApiKeyAuthGuard)
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly jobsService: JobsService,
  ) {}

  @Get(':jobId')
  @ApiOperation({ 
    summary: 'Get job status by ID',
    description: 'Retrieves the status, progress, and results of a specific job by its ID across all queues.'
  })
  @ApiParam({ name: 'jobId', description: 'The unique job ID', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Job status retrieved successfully',
    type: JobStatusResponseDto
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobStatus(@Param('jobId') jobId: string): Promise<JobStatusResponseDto> {
    return this.jobsService.getJobStatus(jobId);
  }

  @Get('queue/:queueName/stats')
  @ApiOperation({ 
    summary: 'Get queue statistics',
    description: 'Retrieves statistics for a specific queue including job counts by status.'
  })
  @ApiParam({ 
    name: 'queueName', 
    description: 'The queue name',
    type: String,
    enum: ['wallet-operations', 'analysis-operations', 'similarity-operations', 'enrichment-operations']
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Queue statistics retrieved successfully',
    type: QueueStatsResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid queue name' })
  async getQueueStats(@Param('queueName') queueName: string): Promise<QueueStatsResponseDto> {
    return this.jobsService.getQueueStats(queueName);
  }

  @Get('queue/:queueName/jobs')
  @ApiOperation({ 
    summary: 'Get jobs in a queue',
    description: 'Retrieves a list of jobs in a specific queue, optionally filtered by status.'
  })
  @ApiParam({ 
    name: 'queueName', 
    description: 'The queue name',
    type: String,
    enum: ['wallet-operations', 'analysis-operations', 'similarity-operations', 'enrichment-operations']
  })
  @ApiQuery({ 
    name: 'status', 
    description: 'Filter jobs by status',
    required: false,
    enum: ['waiting', 'active', 'completed', 'failed', 'delayed', 'paused']
  })
  @ApiQuery({ 
    name: 'limit', 
    description: 'Maximum number of jobs to return',
    required: false,
    type: Number,
    example: 10
  })
  @ApiQuery({ 
    name: 'offset', 
    description: 'Number of jobs to skip',
    required: false,
    type: Number,
    example: 0
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Jobs retrieved successfully',
    type: JobListResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid queue name or parameters' })
  async getQueueJobs(
    @Param('queueName') queueName: string,
    @Query('status') status?: JobState,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ): Promise<JobListResponseDto> {
    return this.jobsService.getQueueJobs(queueName, status, limit, offset);
  }

  @Get()
  @ApiOperation({ 
    summary: 'Get all queue statistics',
    description: 'Retrieves statistics for all queues.'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'All queue statistics retrieved successfully',
    type: AllQueueStatsResponseDto
  })
  async getAllQueueStats(): Promise<AllQueueStatsResponseDto> {
    return this.jobsService.getAllQueueStats();
  }
} 