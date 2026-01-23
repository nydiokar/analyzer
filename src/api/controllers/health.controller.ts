import { Controller, Get, Logger, Header } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HttpHealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseService } from '../services/database.service';
import { HolderProfilesCacheService } from '../services/holder-profiles-cache.service';
import { prisma } from '../../core/services/database-service';
import { Public } from '../shared/decorators/public.decorator';
import { AdminOnly } from '../shared/decorators/admin-only.decorator';
import { QueueHealthService, OverallHealthStatus } from '../../queues/services/queue-health.service';
import { getErrorMessage, getErrorDetails } from '../../core/utils/error-utils';


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
   * Supports both GET and HEAD requests for monitoring tools
   */
  @Get()
  @Public()
  @ApiOperation({
    summary: 'Basic health status (public)',
    description: 'Returns a simple operational status without exposing internal details. Safe for public monitoring. Supports HEAD requests.'
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
      this.logger.error('Basic health check failed:', getErrorMessage(error));
      return {
        status: 'down',
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Detailed health check - Requires admin privileges
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
  @ApiResponse({ status: 401, description: 'Authentication required' })
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
            this.logger.error('Database health check failed:', getErrorMessage(error));
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
            this.logger.error('Holder profile cache health check failed:', getErrorMessage(error));
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
      this.logger.error(`Detailed health check failed after ${totalResponseTime}ms:`, getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Queue health check - Requires admin privileges
   * Returns detailed queue and Redis status for monitoring tools
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
  @ApiResponse({ status: 401, description: 'Authentication required' })
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
      this.logger.error(`Queue health check failed after ${responseTime}ms:`, getErrorMessage(error));
      throw error;
    }
  }

  /**
   * Cache metrics - Requires admin privileges
   * Returns cache statistics for monitoring tools
   */
  @Get('cache-metrics')
  @AdminOnly()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cache metrics (admin only)',
    description: 'Returns comprehensive cache statistics for holder profiles and other cached data. Requires admin privileges.'
  })
  @ApiResponse({ status: 200, description: 'Cache metrics retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Authentication required' })
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
      this.logger.error('Failed to retrieve cache metrics:', getErrorMessage(error));
      throw error;
    }
  }

  private isHolderSnapshotCacheEnabled(): boolean {
    return process.env.DISABLE_HOLDER_PROFILE_SNAPSHOT_CACHE !== 'true';
  }

  /**
   * Prometheus-compatible metrics endpoint - Admin only
   * Returns metrics in Prometheus text exposition format
   * For Prometheus scraping, use an API key with 'admin' or 'full' scope
   */
  @Get('metrics')
  @AdminOnly()
  @ApiBearerAuth()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @ApiOperation({
    summary: 'Prometheus metrics (admin only)',
    description: 'Returns system metrics in Prometheus text format for scraping. Requires admin privileges. Use API key with admin scope for Prometheus scraper.'
  })
  @ApiResponse({ status: 200, description: 'Metrics in Prometheus format', schema: { type: 'string' } })
  @ApiResponse({ status: 401, description: 'Authentication required' })
  @ApiResponse({ status: 403, description: 'Admin privileges required' })
  async getPrometheusMetrics(): Promise<string> {
    try {
      const metrics: string[] = [];

      // Database health
      const dbStart = Date.now();
      try {
        await this.prisma.$queryRaw`SELECT 1`;
        const dbResponseTime = Date.now() - dbStart;
        metrics.push('# HELP sova_database_up Database availability (1 = up, 0 = down)');
        metrics.push('# TYPE sova_database_up gauge');
        metrics.push('sova_database_up 1');
        metrics.push('# HELP sova_database_response_time_ms Database response time in milliseconds');
        metrics.push('# TYPE sova_database_response_time_ms gauge');
        metrics.push(`sova_database_response_time_ms ${dbResponseTime}`);
      } catch (error) {
        metrics.push('# HELP sova_database_up Database availability (1 = up, 0 = down)');
        metrics.push('# TYPE sova_database_up gauge');
        metrics.push('sova_database_up 0');
      }

      // Queue health
      try {
        const queueHealth = await this.queueHealthService.getOverallHealth();
        metrics.push('# HELP sova_queues_healthy Number of healthy queues');
        metrics.push('# TYPE sova_queues_healthy gauge');
        metrics.push(`sova_queues_healthy ${queueHealth.summary.healthyQueues}`);
        metrics.push('# HELP sova_queues_total Total number of monitored queues');
        metrics.push('# TYPE sova_queues_total gauge');
        metrics.push(`sova_queues_total ${queueHealth.summary.totalQueues}`);
        metrics.push('# HELP sova_redis_up Redis availability (1 = up, 0 = down)');
        metrics.push('# TYPE sova_redis_up gauge');
        const redisUp = queueHealth.redis.status === 'healthy' ? 1 : 0;
        metrics.push(`sova_redis_up ${redisUp}`);

        // Per-queue metrics
        queueHealth.queues.forEach(queue => {
          const queueName = queue.queueName.replace(/-/g, '_');
          metrics.push(`# HELP sova_queue_${queueName}_waiting Jobs waiting in ${queue.queueName} queue`);
          metrics.push(`# TYPE sova_queue_${queueName}_waiting gauge`);
          metrics.push(`sova_queue_${queueName}_waiting ${queue.stats.waiting}`);
          metrics.push(`# HELP sova_queue_${queueName}_active Active jobs in ${queue.queueName} queue`);
          metrics.push(`# TYPE sova_queue_${queueName}_active gauge`);
          metrics.push(`sova_queue_${queueName}_active ${queue.stats.active}`);
          metrics.push(`# HELP sova_queue_${queueName}_failed Failed jobs in ${queue.queueName} queue`);
          metrics.push(`# TYPE sova_queue_${queueName}_failed gauge`);
          metrics.push(`sova_queue_${queueName}_failed ${queue.stats.failed}`);
        });
      } catch (error) {
        this.logger.error('Failed to get queue metrics:', getErrorMessage(error));
      }

      // Cache metrics
      const snapshotCacheEnabled = this.isHolderSnapshotCacheEnabled();
      if (snapshotCacheEnabled) {
        try {
          const cacheStats = await this.holderProfilesCacheService.getCacheStats();
          metrics.push('# HELP sova_cache_holder_profiles_total Total cached holder profiles');
          metrics.push('# TYPE sova_cache_holder_profiles_total gauge');
          metrics.push(`sova_cache_holder_profiles_total ${cacheStats.totalKeys}`);
        } catch (error) {
          this.logger.error('Failed to get cache metrics:', getErrorMessage(error));
        }
      }

      // System uptime (approximate - when health endpoint started responding)
      metrics.push('# HELP sova_health_check_timestamp_seconds Timestamp of last health check');
      metrics.push('# TYPE sova_health_check_timestamp_seconds gauge');
      metrics.push(`sova_health_check_timestamp_seconds ${Math.floor(Date.now() / 1000)}`);

      return metrics.join('\n') + '\n';
    } catch (error) {
      this.logger.error('Failed to generate Prometheus metrics:', getErrorMessage(error));
      throw error;
    }
  }
}
