import { Controller, Get, Post, Body, UseGuards, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeController } from '@nestjs/swagger';
import { SecurityLoggerService } from '../shared/services/security-logger.service';
import { SecurityAlertsService } from '../shared/services/security-alerts.service';
import { AdvancedThrottlerService } from '../shared/services/advanced-throttler.service';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';

// Simple API key validation for bot-to-bot communication
interface BotAuthRequest {
  botKey: string;
}

@ApiTags('Bot Integration')
@ApiExcludeController() // Hide from main API docs
@Controller('bot')
export class BotIntegrationController {

  constructor(
    private readonly securityLogger: SecurityLoggerService,
    private readonly securityAlerts: SecurityAlertsService,
    private readonly throttlerService: AdvancedThrottlerService,
  ) {}

  /**
   * Simple health check for your other bot to poll
   */
  @Get('health')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 requests per minute
  @ApiOperation({ summary: 'Bot health check endpoint' })
  async getBotHealthCheck(): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    timestamp: string;
    uptime: number;
    activeAlerts: number;
  }> {
    const metrics = this.securityLogger.getSecurityMetrics('hour');
    const activeAlerts = this.securityAlerts.getActiveAlerts();
    
    let status: 'healthy' | 'warning' | 'critical' = 'healthy';
    
    const criticalEvents = metrics.eventsBySeverity['CRITICAL'] || 0;
    const highEvents = metrics.eventsBySeverity['HIGH'] || 0;
    
    if (criticalEvents > 0 || activeAlerts.some(a => a.severity === 'CRITICAL')) {
      status = 'critical';
    } else if (highEvents > 5 || activeAlerts.some(a => a.severity === 'HIGH')) {
      status = 'warning';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: Math.floor(process.uptime()),
      activeAlerts: activeAlerts.filter(a => !a.resolved).length,
    };
  }

  /**
   * Get security summary for your bot to include in reports
   */
  @Get('security-summary')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 30, ttl: 60000 } }) // 30 requests per minute
  @ApiOperation({ summary: 'Security summary for bot reporting' })
  async getSecuritySummary(): Promise<{
    summary: string;
    emoji: string;
    details: {
      totalEvents: number;
      criticalAlerts: number;
      blockedIPs: number;
      systemHealth: string;
    };
    recommendations: string[];
  }> {
    const metrics = this.securityLogger.getSecurityMetrics('hour');
    const throttlerStats = this.throttlerService.getSecurityStats();
    const activeAlerts = this.securityAlerts.getActiveAlerts();
    
    const criticalAlerts = activeAlerts.filter(a => a.severity === 'CRITICAL' && !a.resolved).length;
    const criticalEvents = metrics.eventsBySeverity['CRITICAL'] || 0;
    
    let summary: string;
    let emoji: string;
    let systemHealth: string;
    
    if (criticalAlerts > 0 || criticalEvents > 0) {
      summary = `🚨 SECURITY ALERT: ${criticalAlerts} critical alerts, ${criticalEvents} critical events`;
      emoji = '🔴';
      systemHealth = 'CRITICAL';
    } else if ((metrics.eventsBySeverity['HIGH'] || 0) > 5) {
      summary = `⚠️ Elevated security activity: ${metrics.totalEvents} events monitored`;
      emoji = '🟠';
      systemHealth = 'WARNING';
    } else {
      summary = `✅ Security systems operating normally`;
      emoji = '🟢';
      systemHealth = 'HEALTHY';
    }

    const recommendations = [];
    if (criticalAlerts > 0) {
      recommendations.push('Review critical security alerts immediately');
    }
    if (throttlerStats.blockedIps > 10) {
      recommendations.push('High number of blocked IPs detected');
    }
    if (recommendations.length === 0) {
      recommendations.push('All systems nominal');
    }

    return {
      summary,
      emoji,
      details: {
        totalEvents: metrics.totalEvents,
        criticalAlerts,
        blockedIPs: throttlerStats.blockedIps,
        systemHealth,
      },
      recommendations,
    };
  }

  /**
   * Get detailed alert information for critical issues
   */
  @Get('critical-alerts')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } }) // 20 requests per minute
  @ApiOperation({ summary: 'Get critical security alerts' })
  async getCriticalAlerts(): Promise<{
    hasAlerts: boolean;
    alertCount: number;
    alerts: Array<{
      title: string;
      severity: string;
      message: string;
      timestamp: string;
      details?: any;
    }>;
  }> {
    const activeAlerts = this.securityAlerts.getActiveAlerts();
    const criticalAlerts = activeAlerts.filter(
      alert => ['CRITICAL', 'HIGH'].includes(alert.severity)
    );

    return {
      hasAlerts: criticalAlerts.length > 0,
      alertCount: criticalAlerts.length,
      alerts: criticalAlerts.map(alert => ({
        title: alert.title,
        severity: alert.severity,
        message: alert.message,
        timestamp: alert.timestamp.toISOString(),
        details: alert.details,
      })),
    };
  }

  /**
   * Simple endpoint for your bot to post acknowledgments
   */
  @Post('acknowledge')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Acknowledge alerts from external bot' })
  async acknowledgeAlert(
    @Body() body: { alertId?: string; message?: string }
  ): Promise<{ success: boolean; message: string }> {
    if (body.alertId) {
      const resolved = this.securityAlerts.resolveAlert(body.alertId);
      return {
        success: resolved,
        message: resolved ? 'Alert acknowledged' : 'Alert not found',
      };
    }

    return {
      success: true,
      message: 'General acknowledgment received',
    };
  }
}