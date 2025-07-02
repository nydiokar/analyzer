import { Controller, Get, Param, Query, Logger, Post, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiQuery, ApiBody } from '@nestjs/swagger';
import { JobsService } from './jobs.service';
import { JobState } from 'bullmq';
import { 
  JobStatusResponseDto, 
  QueueStatsResponseDto, 
  AllQueueStatsResponseDto, 
  JobListResponseDto,
  SyncWalletJobRequestDto,
  AnalyzeWalletJobRequestDto,
  SimilarityAnalysisJobRequestDto,
  JobSubmissionResponseDto
} from './dto/job-status.dto';

@ApiTags('Jobs')
@Controller('jobs')
export class JobsController {
  private readonly logger = new Logger(JobsController.name);

  constructor(
    private readonly jobsService: JobsService,
  ) {}

  // === C2 Task: Job Submission Endpoints ===

  @Post('wallets/sync')
  @HttpCode(202)
  @ApiOperation({ 
    summary: 'Submit wallet sync job',
    description: 'Submits a job to sync wallet transaction data from Helius API.'
  })
  @ApiBody({ type: SyncWalletJobRequestDto })
  @ApiResponse({ 
    status: 202, 
    description: 'Sync job submitted successfully',
    type: JobSubmissionResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid wallet address or parameters' })
  async submitSyncWalletJob(@Body() dto: SyncWalletJobRequestDto): Promise<JobSubmissionResponseDto> {
    return this.jobsService.submitSyncWalletJob(dto);
  }

  @Post('wallets/analyze')
  @HttpCode(202)
  @ApiOperation({ 
    summary: 'Submit wallet analysis job',
    description: 'Submits jobs to perform PNL and/or behavior analysis on a wallet.'
  })
  @ApiBody({ type: AnalyzeWalletJobRequestDto })
  @ApiResponse({ 
    status: 202, 
    description: 'Analysis job(s) submitted successfully',
    type: JobSubmissionResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid wallet address or analysis types' })
  async submitAnalyzeWalletJob(@Body() dto: AnalyzeWalletJobRequestDto): Promise<JobSubmissionResponseDto> {
    return this.jobsService.submitAnalyzeWalletJob(dto);
  }

  @Post('similarity/analyze')
  @HttpCode(202)
  @ApiOperation({ 
    summary: 'Submit similarity analysis job',
    description: 'Submits a job to perform similarity analysis on multiple wallets.'
  })
  @ApiBody({ type: SimilarityAnalysisJobRequestDto })
  @ApiResponse({ 
    status: 202, 
    description: 'Similarity analysis job submitted successfully',
    type: JobSubmissionResponseDto
  })
  @ApiResponse({ status: 400, description: 'Invalid wallet addresses or parameters' })
  async submitSimilarityAnalysisJob(@Body() dto: SimilarityAnalysisJobRequestDto): Promise<JobSubmissionResponseDto> {
    return this.jobsService.submitSimilarityAnalysisJob(dto);
  }

  // === Existing Job Status Endpoints ===

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

  @Get(':jobId/progress')
  @ApiOperation({ 
    summary: 'Get job progress by ID',
    description: 'Retrieves only the progress information for a specific job.'
  })
  @ApiParam({ name: 'jobId', description: 'The unique job ID', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Job progress retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        status: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed'] },
        progress: { oneOf: [{ type: 'number' }, { type: 'object' }] }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobProgress(@Param('jobId') jobId: string): Promise<{ jobId: string; status: string; progress: number | object }> {
    return this.jobsService.getJobProgress(jobId);
  }

  @Get(':jobId/result')
  @ApiOperation({ 
    summary: 'Get job result by ID',
    description: 'Retrieves only the result information for a specific job.'
  })
  @ApiParam({ name: 'jobId', description: 'The unique job ID', type: String })
  @ApiResponse({ 
    status: 200, 
    description: 'Job result retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        jobId: { type: 'string' },
        status: { type: 'string', enum: ['waiting', 'active', 'completed', 'failed'] },
        result: { type: 'object', description: 'Job result data (only available for completed jobs)' },
        error: { type: 'string', description: 'Error message (only available for failed jobs)' }
      }
    }
  })
  @ApiResponse({ status: 404, description: 'Job not found' })
  async getJobResult(@Param('jobId') jobId: string): Promise<{ jobId: string; status: string; result?: any; error?: string }> {
    return this.jobsService.getJobResult(jobId);
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