import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HttpHealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseService } from '../services/database.service';
import { HolderProfilesCacheService } from '../services/holder-profiles-cache.service';
import { prisma } from '../../core/services/database-service';
import { Public } from '../shared/decorators/public.decorator';
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

  @Get()
  @Public() // Health endpoint should be accessible without authentication
  @HealthCheck()
  @ApiOperation({ summary: 'Check the health of the API and its dependencies' })
  @ApiResponse({ status: 200, description: 'Health check passed successfully' })
  @ApiResponse({ status: 503, description: 'Health check failed' })
  async check() {
    const startTime = Date.now();
    
    try {
      const snapshotCacheEnabled = this.isHolderSnapshotCacheEnabled();
      const result = await this.health.check([
        // Check database connection with timeout
        async () => {
          const dbStartTime = Date.now();
          try {
            // Use Prisma's raw query to check database connection
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
            return {
              database: {
                status: 'down',
                error: error instanceof Error ? error.message : 'Unknown database error',
              },
            } as HealthIndicatorResult;
          }
        },
        async () => {
          if (!snapshotCacheEnabled) {
            return {
              holderProfileSnapshots: {
                status: 'up',
                message: 'Snapshot cache disabled',
                enabled: false,
              },
            } as HealthIndicatorResult;
          }

          const snapshotStart = Date.now();
          try {
            const total = await this.databaseService.countHolderProfileSnapshots();
            const responseTime = Date.now() - snapshotStart;
            const threshold = Number(process.env.HOLDER_PROFILE_SNAPSHOT_MAX_ROWS || 500000);
            const withinThreshold = total <= threshold;
            return {
              holderProfileSnapshots: {
                status: withinThreshold ? 'up' : 'down',
                total,
                threshold,
                responseTime: `${responseTime}ms`,
                message: withinThreshold
                  ? 'Snapshot table within threshold'
                  : 'Snapshot table exceeds threshold',
              },
            } as HealthIndicatorResult;
          } catch (error) {
            this.logger.error('Holder profile snapshot health check failed:', error);
            return {
              holderProfileSnapshots: {
                status: 'down',
                error: error instanceof Error ? error.message : 'Unknown snapshot error',
              },
            } as HealthIndicatorResult;
          }
        },
      ]);

      // Add overall response time
      const totalResponseTime = Date.now() - startTime;
      return {
        ...result,
        timestamp: new Date().toISOString(),
        responseTime: `${totalResponseTime}ms`,
        version: process.env.npm_package_version || 'unknown',
      };
    } catch (error) {
      this.logger.error('Health check failed:', error);
      throw error;
    }
  }

  @Get('queues')
  @Public() // Queue health endpoint should be accessible without authentication
  @ApiOperation({ 
    summary: 'Check the health of BullMQ queues and Redis',
    description: 'Returns detailed health status for all monitored queues, Redis connection, and overall system health'
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

      // If the system is unhealthy, we should still return 200 but with unhealthy status
      // The HTTP status code 503 should be reserved for cases where the endpoint itself fails
      return healthStatus;
      
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error(`Queue health check failed after ${responseTime}ms:`, error);
      
      // Return a minimal unhealthy status if the check itself fails
      const failedHealthStatus: OverallHealthStatus = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        redis: {
          status: 'unhealthy',
          connectionStatus: 'error',
          issues: ['Health check failed']
        },
        queues: [],
        summary: {
          totalQueues: 0,
          healthyQueues: 0,
          degradedQueues: 0,
          unhealthyQueues: 0,
          totalJobs: { waiting: 0, active: 0, completed: 0, failed: 0 }
        },
        issues: [`Queue health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`]
      };
      
      return failedHealthStatus;
    }
  }

  @Get('holder-profile-cache-metrics')
  @Public() // Cache metrics should be accessible without authentication
  @ApiOperation({
    summary: 'Get holder profile cache hit rate metrics',
    description: 'Returns cache performance metrics for holder profiles across Tier 1 (Redis) and Tier 2 (PostgreSQL) caches. Use this to validate cache effectiveness and identify optimization opportunities.'
  })
  @ApiResponse({
    status: 200,
    description: 'Cache metrics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        tier1: {
          type: 'object',
          properties: {
            hits: { type: 'number' },
            misses: { type: 'number' },
            hitRate: { type: 'number', description: 'Hit rate percentage (0-100)' },
            total: { type: 'number' }
          }
        },
        tier2: {
          type: 'object',
          properties: {
            hits: { type: 'number' },
            misses: { type: 'number' },
            partial: { type: 'number', description: 'Partial hits (some wallets cached)' },
            hitRate: { type: 'number', description: 'Hit rate percentage (0-100)' },
            total: { type: 'number' }
          }
        },
        uptime: {
          type: 'object',
          properties: {
            milliseconds: { type: 'number' },
            hours: { type: 'number' },
            since: { type: 'string', format: 'date-time' }
          }
        }
      }
    }
  })
  async getCacheMetrics() {
    const startTime = Date.now();
    try {
      const metrics = this.holderProfilesCacheService.getCacheMetrics();
      const responseTime = Date.now() - startTime;

      this.logger.log(
        `Cache metrics retrieved in ${responseTime}ms: ` +
        `Tier1 ${metrics.tier1.hitRate.toFixed(1)}% (${metrics.tier1.total} req), ` +
        `Tier2 ${metrics.tier2.hitRate.toFixed(1)}% (${metrics.tier2.total} req)`
      );

      return {
        ...metrics,
        timestamp: new Date().toISOString(),
        responseTime: `${responseTime}ms`,
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      this.logger.error(`Cache metrics retrieval failed after ${responseTime}ms:`, error);
      throw error;
    }
  }

  private isHolderSnapshotCacheEnabled(): boolean {
    return process.env.DISABLE_HOLDER_PROFILE_SNAPSHOT_CACHE === 'true' ? false : true;
  }
} 
