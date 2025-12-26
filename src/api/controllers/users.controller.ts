import { Controller, Get, Req, HttpStatus, ForbiddenException, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { User } from '@prisma/client';
import { UserProfileDto } from '../shared/dto/user-profile.dto';
import { JobsService } from '../services/jobs.service';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@ApiTags('Users')
@Controller('users')
@ApiBearerAuth()
export class UsersController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('me')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute for profile access
  @ApiOperation({ summary: "Get the authenticated user's profile" })
  @ApiResponse({ status: HttpStatus.OK, description: 'User profile retrieved successfully.', type: UserProfileDto })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized.' })
  async getProfile(@Req() req: AuthenticatedRequest): Promise<UserProfileDto> {
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }
    return {
      id: user.id,
      isDemo: user.isDemo,
    };
  }

  @Get('me/jobs')
  @ApiOperation({ summary: "Get the authenticated user's job history" })
  @ApiResponse({ status: HttpStatus.OK, description: 'Job history retrieved successfully.' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized.' })
  async getMyJobs(
    @Req() req: AuthenticatedRequest,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const user = req.user;
    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const limitValue = limit ? parseInt(limit, 10) : 20;
    const offsetValue = offset ? parseInt(offset, 10) : 0;

    const jobs = await this.jobsService.getUserJobHistory(user.id, {
      jobNames: ['analyze-holder-profiles', 'similarity-analysis-flow'],
      limit: limitValue,
      offset: offsetValue,
    });

    return jobs.map(job => ({
      id: job.id,
      name: job.name,
      queue: job.queue,
      status: job.status,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt,
      processingTime: job.finishedAt && job.processedAt
        ? new Date(job.finishedAt).getTime() - new Date(job.processedAt).getTime()
        : 0,
      mode: job.data?.mode,
      tokenMint: job.data?.tokenMint,
      walletAddress: job.data?.walletAddress,
      walletAddresses: job.data?.walletAddresses,
      topN: job.data?.topN,
      requestId: job.data?.requestId,
      similarityConfig: job.data?.similarityConfig,
      timeoutMinutes: job.data?.timeoutMinutes,
      failureThreshold: job.data?.failureThreshold,
      enrichMetadata: job.data?.enrichMetadata,
      totalHolders: job.result?.metadata?.totalHoldersAnalyzed || 0,
    }));
  }
}
