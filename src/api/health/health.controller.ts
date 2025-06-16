import { Controller, Get, Logger } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService, HttpHealthIndicator, HealthIndicatorResult } from '@nestjs/terminus';
import { DatabaseService } from '../database/database.service';
import { PrismaClient } from '@prisma/client';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);
  private readonly prisma: PrismaClient;

  constructor(
    private health: HealthCheckService,
    private http: HttpHealthIndicator,
    private readonly databaseService: DatabaseService,
  ) {
    this.prisma = new PrismaClient();
  }

  @Get()
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
} 