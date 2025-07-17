import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HttpHealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseService } from '../database/database.service';
import { PrismaClient } from '@prisma/client';
import { Public } from '../auth/public.decorator';
import { QueueHealthService, OverallHealthStatus } from '../../queues/services/queue-health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly prisma: PrismaClient;

  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private readonly databaseService: DatabaseService,
    private readonly queueHealthService: QueueHealthService,
  ) {
    this.prisma = new PrismaClient();
  }

  @Get()
  @Public() // Health endpoint should be accessible without authentication
  @HealthCheck()
  @ApiOperation({ summary: 'Check the health of the API and its dependencies' })
  @ApiResponse({ status: 200, description: 'Health check passed successfully' })
  @ApiResponse({ status: 503, description: 'Health check failed' })
  async check() {
    const startTime = Date.now();
    
    try {
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
} 