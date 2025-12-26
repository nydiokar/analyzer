import { Controller, Get, Query, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AdminOnly } from '../shared/decorators/admin-only.decorator';
import { JobsService } from '../services/jobs.service';
import { JobState } from 'bullmq';

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/job-history')
@AdminOnly()
export class AdminJobHistoryController {
  constructor(private readonly jobsService: JobsService) {}

  /**
   * GET /api/v1/admin/job-history
   * Returns job history for admin (paginated)
   */
  @Get()
  @ApiOperation({ summary: 'Get job history (admin only)' })
  @ApiResponse({ status: HttpStatus.OK, description: 'Job history retrieved successfully.' })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Admin privileges required.' })
  async getAdminJobHistory(
    @Query('userId') userId?: string,
    @Query('status') status?: string,
    @Query('queue') queue?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const statusValue = status as JobState | undefined;

    return this.jobsService.getAdminJobHistory({
      userId,
      status: statusValue,
      queue,
      limit: limit ? parseInt(limit, 10) : 50,
      offset: offset ? parseInt(offset, 10) : 0,
    });
  }
}
