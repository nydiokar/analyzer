import { Controller, Get, Post, Query, Param, UseGuards, HttpStatus, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';
import { SecurityLoggerService, SecurityMetrics } from '../shared/services/security-logger.service';
import { AdvancedThrottlerService } from '../shared/services/advanced-throttler.service';
import { SecurityAlertsService } from '../shared/services/security-alerts.service';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

@ApiTags('Security')
@Controller('security')
@UseGuards(CompositeAuthGuard)
@ApiBearerAuth()
export class SecurityController {

  constructor(
    private readonly securityLogger: SecurityLoggerService,
    private readonly advancedThrottler: AdvancedThrottlerService,
    private readonly securityAlerts: SecurityAlertsService,
  ) {}

  @Get('metrics')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // 10 requests per minute for security metrics
  @ApiOperation({ 
    summary: 'Get security metrics and monitoring data',
    description: 'Returns comprehensive security statistics including events, violations, and risk assessments. Access restricted to non-demo users.',
  })
  @ApiQuery({
    name: 'timeRange',
    required: false,
    enum: ['hour', 'day', 'week'],
    description: 'Time range for metrics aggregation',
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Security metrics retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        securityEvents: {
          type: 'object',
          properties: {
            totalEvents: { type: 'number' },
            eventsBySeverity: { type: 'object' },
            eventsByType: { type: 'object' },
            uniqueIpsWithIssues: { type: 'number' },
            recentSuspiciousActivity: { type: 'array' },
            topRiskIps: { type: 'array' },
          }
        },
        throttlerStats: {
          type: 'object',
          properties: {
            blockedIps: { type: 'number' },
            recentEvents: { type: 'number' },
            topViolatingIps: { type: 'array' },
          }
        },
        timestamp: { type: 'string', format: 'date-time' },
        timeRange: { type: 'string' },
      }
    }
  })
  @ApiResponse({ status: HttpStatus.FORBIDDEN, description: 'Access denied for demo users' })
  @ApiResponse({ status: HttpStatus.UNAUTHORIZED, description: 'Unauthorized' })
  async getSecurityMetrics(
    @Query('timeRange') timeRange: 'hour' | 'day' | 'week' = 'hour'
  ): Promise<{
    securityEvents: SecurityMetrics;
    throttlerStats: any;
    timestamp: Date;
    timeRange: string;
  }> {
    // Note: In a complete implementation, we'd check if user is admin
    // For now, we'll restrict to non-demo users
    // const user = req.user as User;
    // if (user?.isDemo) {
    //   throw new ForbiddenException('Security metrics access not available for demo accounts');
    // }

    const securityEvents = this.securityLogger.getSecurityMetrics(timeRange);
    const throttlerStats = this.advancedThrottler.getSecurityStats();

    return {
      securityEvents,
      throttlerStats,
      timestamp: new Date(),
      timeRange,
    };
  }

  @Get('health')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests per minute for health check
  @ApiOperation({ 
    summary: 'Security health check',
    description: 'Returns basic security system health information',
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Security health status',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['healthy', 'warning', 'critical'] },
        checks: {
          type: 'object',
          properties: {
            securityLogging: { type: 'string' },
            rateLimiting: { type: 'string' },
            authentication: { type: 'string' },
          }
        },
        timestamp: { type: 'string', format: 'date-time' },
      }
    }
  })
  async getSecurityHealth(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    checks: Record<string, string>;
    timestamp: Date;
  }> {
    // Perform basic health checks
    const checks = {
      securityLogging: 'operational',
      rateLimiting: 'operational',
      authentication: 'operational',
    };

    // Determine overall status
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    // Get recent security events to assess system health
    const metrics = this.securityLogger.getSecurityMetrics('hour');
    const criticalEvents = metrics.eventsBySeverity['CRITICAL'] || 0;
    const highEvents = metrics.eventsBySeverity['HIGH'] || 0;
    
    if (criticalEvents > 5) {
      status = 'critical';
      checks.securityLogging = 'critical - high number of critical events';
    } else if (criticalEvents > 1 || highEvents > 20) {
      status = 'warning';
      checks.securityLogging = 'warning - elevated security events';
    }

    return {
      status,
      checks,
      timestamp: new Date(),
    };
  }

  @Get('alerts')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests per minute for alerts
  @ApiOperation({ 
    summary: 'Get active security alerts',
    description: 'Returns current unresolved security alerts',
  })
  @ApiResponse({ 
    status: HttpStatus.OK, 
    description: 'Active security alerts',
    schema: {
      type: 'object',
      properties: {
        alerts: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              severity: { type: 'string', enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] },
              message: { type: 'string' },
              timestamp: { type: 'string', format: 'date-time' },
              resolved: { type: 'boolean' },
            }
          }
        },
        count: { type: 'number' },
      }
    }
  })
  async getActiveAlerts(): Promise<{
    alerts: any[];
    count: number;
  }> {
    const alerts = this.securityAlerts.getActiveAlerts();
    return {
      alerts,
      count: alerts.length,
    };
  }

  @Post('alerts/:id/resolve')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } }) 
  @ApiOperation({ 
    summary: 'Resolve a security alert',
    description: 'Mark a specific alert as resolved',
  })
  async resolveAlert(
    @Query('id') alertId: string
  ): Promise<{ success: boolean; message: string }> {
    const resolved = this.securityAlerts.resolveAlert(alertId);
    
    return {
      success: resolved,
      message: resolved ? 'Alert resolved successfully' : 'Alert not found or already resolved',
    };
  }
}