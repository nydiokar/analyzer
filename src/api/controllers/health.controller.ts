import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HttpHealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseService } from '../services/database.service';
import { HolderProfilesCacheService } from '../services/holder-profiles-cache.service';
import { prisma } from '../../core/services/database-service';
import { Public } from '../shared/decorators/public.decorator';
import { AdminOnly } from '../shared/decorators/admin-only.decorator';
import { QueueHealthService, OverallHealthStatus } from '../../queues/services/queue-health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly prisma = prisma;

  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private readonly databaseService: DatabaseService,
    private readonly queueHealthService: QueueHealthService,
    private readonly holderProfilesCacheService: HolderProfilesCacheService,
  ) {}

  /**
   * Public basic health check - Returns only operational status
   * Safe to expose publicly for external monitoring/status pages
   */
  @Get()
  @Public()
  @ApiOperation({
    summary: 'Basic health status (public)',
    description: 'Returns a simple operational status without exposing internal details. Safe for public monitoring.'
  })
  @ApiResponse({ status: 200, description: 'Service is operational' })
  @ApiResponse({ status: 503, description: 'Service is down or degraded' })
  async getBasicHealth() {
    try {
      // Quick database ping
      await this.prisma.$queryRaw`SELECT 1`;

      return {
        status: 'operational',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Basic health check failed:', error);
      return {
        status: 'down',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Detailed health check - Requires authentication (admin-only recommended)
   * Exposes internal metrics for debugging and monitoring
   */
  @Get('detailed')
  @AdminOnly()
  @ApiBearerAuth()
  @HealthCheck()
  @ApiOperation({
    summary: 'Detailed health check (admin only)',
    description: 'Returns comprehensive health status including database, cache, and performance metrics. Requires admin privileges.'
  })
  @ApiResponse({ status: 200, description: 'Health check passed successfully' })
  @ApiResponse({ status: 403, description: 'Admin privileges required' })
  @ApiResponse({ status: 503, description: 'Health check failed' })
  async checkDetailed() {
    const startTime = Date.now();

    try {
      const snapshotCacheEnabled = this.isHolderSnapshotCacheEnabled();
      const result = await this.health.check([
        // Check database connection with timeout
        async () => {
          const dbStartTime = Date.now();
          try {
            await this.prisma.$queryRaw`SELECT 1`;
            const responseTime = Date.now() - dbStartTime;
            return {
              database: {
                status: 'up',
                responseTime: `${responseTime}ms`,
              },
            } as HealthIndicatorResult;
          } catch (error) {
            this.logger.error('Database health check failed:', error);
            const responseTime = Date.now() - dbStartTime;
            return {
              database: {
                status: 'down',
                responseTime: `${responseTime}ms`,
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            } as HealthIndicatorResult;
          }
        },
        // Check holder profile snapshot cache availability
        async () => {
          if (!snapshotCacheEnabled) {
            return {
              holderProfileCache: {
                status: 'up' as const,
                message: 'Holder profile snapshot cache is disabled via environment variable',
              },
            } as HealthIndicatorResult;
          }

          try {
            const stats = await this.holderProfilesCacheService.getCacheStats();
            const isHealthy = stats.totalKeys >= 0; // Cache is accessible
            return {
              holderProfileCache: {
                status: isHealthy ? 'up' : 'degraded',
                totalKeys: stats.totalKeys,
                sampleKeys: stats.sampleKeys.length,
              },
            } as HealthIndicatorResult;
          } catch (error) {
            this.logger.error('Holder profile cache health check failed:', error);
            return {
              holderProfileCache: {
                status: 'down',
                error: error instanceof Error ? error.message : 'Unknown error',
              },
            } as HealthIndicatorResult;
          }
        },
      ]);

      const totalResponseTime = Date.now() - startTime;
      this.logger.log(`Detailed health check completed in ${totalResponseTime}ms`);

      return {
        ...result,
        responseTime: `${totalResponseTime}ms`,
      };
    } catch (error) {
      const totalResponseTime = Date.now() - startTime;
      this.logger.error(`Detailed health check failed after ${totalResponseTime}ms:`, error);
      throw error;
    }
  }

  /**
   * Queue health check - Admin only
   * Returns detailed queue and Redis status
   */
  @Get('queues')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Queue health status (admin only)',
    description: 'Returns detailed health status for all monitored queues, Redis connection, and overall system health. Requires admin privileges.'
  })
  @ApiResponse({
    status: 200,
    description: 'Queue health check completed successfully',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
        timestamp: { type: 'string' },
        redis: { type: 'object' },
        queues: { type: 'array' },
        summary: { type: 'object' },
        issues: { type: 'array' }
      }
    }
  })
  @ApiResponse({ status: 403, description: 'Admin privileges required' })
  @ApiResponse({ status: 503, description: 'Queue health check failed or system unhealthy' })
  async checkQueues(): Promise<OverallHealthStatus> {
    const startTime = Date.now();

    try {
      this.logger.log('Performing queue health check...');

      const healthStatus = await this.queueHealthService.getOverallHealth();
      const responseTime = Date.now() - startTime;

      this.logger.log(
        `Queue health check completed in ${responseTime}ms: ${healthStatus.status} ` +
        `(${healthStatus.summary.healthyQueues}/${healthStatus.summary.totalQueues} queues healthy, ` +
        `Redis: ${healthStatus.redis.status})`
      );

      return healthStatus;
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error(`Queue health check failed after ${responseTime}ms:`, error);
      throw error;
    }
  }

  /**
   * Cache metrics - Admin only
   * Returns cache statistics for monitoring
   */
  @Get('cache-metrics')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cache metrics (admin only)',
    description: 'Returns comprehensive cache statistics for holder profiles and other cached data. Requires admin privileges.'
  })
  @ApiResponse({ status: 200, description: 'Cache metrics retrieved successfully' })
  @ApiResponse({ status: 403, description: 'Admin privileges required' })
  async getCacheMetrics() {
    try {
      const snapshotCacheEnabled = this.isHolderSnapshotCacheEnabled();

      if (!snapshotCacheEnabled) {
        return {
          holderProfileCache: {
            enabled: false,
            message: 'Holder profile snapshot cache is disabled',
          },
          timestamp: new Date().toISOString(),
        };
      }

      const stats = await this.holderProfilesCacheService.getCacheStats();

      return {
        holderProfileCache: {
          enabled: true,
          totalKeys: stats.totalKeys,
          sampleKeysCount: stats.sampleKeys.length,
        },
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.error('Failed to retrieve cache metrics:', error);
      throw error;
    }
  }

  private isHolderSnapshotCacheEnabled(): boolean {
    return process.env.DISABLE_HOLDER_PROFILE_SNAPSHOT_CACHE !== 'true';
  }
}
