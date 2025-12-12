import { Controller, Get, Post, Body, UseGuards, HttpStatus, Req, ForbiddenException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiExcludeController } from '@nestjs/swagger';
import { SecurityLoggerService } from '../shared/services/security-logger.service';
import { SecurityAlertsService } from '../shared/services/security-alerts.service';
import { AdvancedThrottlerService } from '../shared/services/advanced-throttler.service';
import { CompositeAuthGuard } from '../shared/guards/composite-auth.guard';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { User } from '@prisma/client';

// Simple API key validation for bot-to-bot communication
interface BotAuthRequest {
  botKey: string;
}

@ApiTags('Bot Integration')
@ApiExcludeController() // Hide from main API docs
@Controller('bot')
export class BotIntegrationController {
  private readonly adminUserIds: Set<string>;
  private readonly adminEmails: Set<string>;

  constructor(
    private readonly securityLogger: SecurityLoggerService,
    private readonly securityAlerts: SecurityAlertsService,
    private readonly throttlerService: AdvancedThrottlerService,
    private readonly configService: ConfigService,
  ) {
    const ids = (this.configService.get<string>('ADMIN_USER_IDS') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const emails = (this.configService.get<string>('ADMIN_EMAILS') || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    this.adminUserIds = new Set(ids);
    this.adminEmails = new Set(emails);
  }

  /**
   * Simple health check for your other bot to poll
   */
  @Get('health')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 60, ttl: 60000 } }) // 60 requests per minute
  @ApiOperation({ summary: 'Bot health check endpoint' })
  async getBotHealthCheck(
    @Req() req: Request & { user?: User },
  ): Promise<{
    status: 'healthy' | 'warning' | 'critical';
    timestamp: string;
    uptime: number;
    activeAlerts: number;
  }> {
    this.assertAdmin(req.user);
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
  async getSecuritySummary(
    @Req() req: Request & { user?: User },
  ): Promise<{
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
    this.assertAdmin(req.user);
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
  async getCriticalAlerts(
    @Req() req: Request & { user?: User },
  ): Promise<{
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
    this.assertAdmin(req.user);
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
    @Req() req: Request & { user?: User },
    @Body() body: { alertId?: string; message?: string }
  ): Promise<{ success: boolean; message: string }> {
    this.assertAdmin(req.user);
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

  private assertAdmin(user?: User): void {
    if (!user) {
      throw new ForbiddenException('Admin access required');
    }
    const isAdminId = user.id && this.adminUserIds.has(user.id);
    const isAdminEmail = user.email && this.adminEmails.has(user.email.toLowerCase());
    if (isAdminId || isAdminEmail) {
      return;
    }
    throw new ForbiddenException('Admin access required');
  }
}
