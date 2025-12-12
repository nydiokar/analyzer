import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SecurityLoggerService, SecurityEvent } from './security-logger.service';
import { AdvancedThrottlerService } from './advanced-throttler.service';

interface AlertThreshold {
  criticalEventsPerHour: number;
  highEventsPerHour: number;
  uniqueSuspiciousIpsPerHour: number;
  rateLimitViolationsPerHour: number;
  failedLoginsPerHour: number;
}

interface SecurityAlert {
  id: string;
  title: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  message: string;
  details: Record<string, any>;
  timestamp: Date;
  resolved: boolean;
}

interface SecurityDigest {
  period: string;
  summary: {
    totalEvents: number;
    criticalIssues: number;
    newThreats: number;
    blockedAttacks: number;
  };
  topIssues: Array<{
    type: string;
    count: number;
    description: string;
  }>;
  recommendations: string[];
}

@Injectable()
export class SecurityAlertsService {
  private readonly logger = new Logger(SecurityAlertsService.name);
  private readonly alerts: SecurityAlert[] = [];
  private readonly maxAlertsInMemory = 100;
  
  // Alert thresholds (configurable via environment)
  private readonly thresholds: AlertThreshold = {
    criticalEventsPerHour: parseInt(this.configService.get<string>('SECURITY_CRITICAL_THRESHOLD') || '3'),
    highEventsPerHour: parseInt(this.configService.get<string>('SECURITY_HIGH_THRESHOLD') || '10'),
    uniqueSuspiciousIpsPerHour: parseInt(this.configService.get<string>('SECURITY_SUSPICIOUS_IPS_THRESHOLD') || '5'),
    rateLimitViolationsPerHour: parseInt(this.configService.get<string>('SECURITY_RATE_LIMIT_THRESHOLD') || '20'),
    failedLoginsPerHour: parseInt(this.configService.get<string>('SECURITY_FAILED_LOGINS_THRESHOLD') || '15'),
  };

  // Notification settings
  private readonly telegramEnabled = Boolean(this.configService.get<string>('TELEGRAM_BOT_TOKEN'));
  private readonly emailEnabled = Boolean(this.configService.get<string>('SMTP_HOST'));
  private readonly webhookEnabled = Boolean(this.configService.get<string>('SECURITY_WEBHOOK_URL'));

  constructor(
    private readonly configService: ConfigService,
    private readonly securityLogger: SecurityLoggerService,
    private readonly throttlerService: AdvancedThrottlerService,
  ) {
    this.logger.log('Security Alerts Service initialized');
    this.logger.log(`Alert thresholds: ${JSON.stringify(this.thresholds)}`);
  }

  /**
   * Real-time security monitoring - runs every 5 minutes
   */
  @Cron('*/5 * * * *') // Every 5 minutes
  async performSecurityCheck(): Promise<void> {
    try {
      const metrics = this.securityLogger.getSecurityMetrics('hour');
      const throttlerStats = this.throttlerService.getSecurityStats();
      
      await this.checkCriticalEvents(metrics);
      await this.checkSuspiciousIPs(metrics);
      await this.checkRateLimitViolations(throttlerStats);
      await this.checkFailedLogins(metrics);
      
      this.cleanupOldAlerts();
    } catch (error) {
      this.logger.error('Failed to perform security check:', error);
    }
  }

  /**
   * Daily security digest - runs at 8 AM
   */
  @Cron('0 8 * * *') // Daily at 8 AM
  async sendDailySummary(): Promise<void> {
    try {
      const digest = await this.generateSecurityDigest();
      await this.sendDigest(digest);
    } catch (error) {
      this.logger.error('Failed to send daily security summary:', error);
    }
  }

  /**
   * Weekly security report - runs on Mondays at 9 AM
   */
  @Cron('0 9 * * 1') // Mondays at 9 AM
  async sendWeeklyReport(): Promise<void> {
    try {
      const weeklyDigest = await this.generateSecurityDigest('week');
      await this.sendReport(weeklyDigest);
    } catch (error) {
      this.logger.error('Failed to send weekly security report:', error);
    }
  }

  private async checkCriticalEvents(metrics: any): Promise<void> {
    const criticalCount = metrics.eventsBySeverity['CRITICAL'] || 0;
    const highCount = metrics.eventsBySeverity['HIGH'] || 0;

    if (criticalCount >= this.thresholds.criticalEventsPerHour) {
      await this.createAlert({
        title: 'Critical Security Events Detected',
        severity: 'CRITICAL',
        message: `${criticalCount} critical security events detected in the last hour`,
        details: {
          criticalEvents: criticalCount,
          recentEvents: metrics.recentSuspiciousActivity.slice(0, 5),
          threshold: this.thresholds.criticalEventsPerHour,
        },
      });
    }

    if (highCount >= this.thresholds.highEventsPerHour) {
      await this.createAlert({
        title: 'Elevated Security Activity',
        severity: 'HIGH',
        message: `${highCount} high-severity security events detected`,
        details: {
          highEvents: highCount,
          threshold: this.thresholds.highEventsPerHour,
        },
      });
    }
  }

  private async checkSuspiciousIPs(metrics: any): Promise<void> {
    const suspiciousIps = metrics.uniqueIpsWithIssues;
    
    if (suspiciousIps >= this.thresholds.uniqueSuspiciousIpsPerHour) {
      await this.createAlert({
        title: 'Multiple Suspicious IP Addresses',
        severity: 'HIGH',
        message: `${suspiciousIps} unique IPs showing suspicious behavior`,
        details: {
          suspiciousIps,
          topRiskIps: metrics.topRiskIps.slice(0, 5),
          threshold: this.thresholds.uniqueSuspiciousIpsPerHour,
        },
      });
    }
  }

  private async checkRateLimitViolations(throttlerStats: any): Promise<void> {
    const violations = throttlerStats.recentEvents;
    
    if (violations >= this.thresholds.rateLimitViolationsPerHour) {
      await this.createAlert({
        title: 'High Rate Limit Violations',
        severity: 'MEDIUM',
        message: `${violations} rate limit violations detected`,
        details: {
          violations,
          blockedIps: throttlerStats.blockedIps,
          topViolatingIps: throttlerStats.topViolatingIps.slice(0, 3),
          threshold: this.thresholds.rateLimitViolationsPerHour,
        },
      });
    }
  }

  private async checkFailedLogins(metrics: any): Promise<void> {
    const failedLogins = metrics.eventsByType['AUTH_FAILURE'] || 0;
    
    if (failedLogins >= this.thresholds.failedLoginsPerHour) {
      await this.createAlert({
        title: 'High Failed Login Attempts',
        severity: 'MEDIUM',
        message: `${failedLogins} failed login attempts in the last hour`,
        details: {
          failedLogins,
          threshold: this.thresholds.failedLoginsPerHour,
          possibleBruteForce: failedLogins > this.thresholds.failedLoginsPerHour * 2,
        },
      });
    }
  }

  private async createAlert(alertData: Omit<SecurityAlert, 'id' | 'timestamp' | 'resolved'>): Promise<void> {
    const alert: SecurityAlert = {
      id: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(),
      resolved: false,
      ...alertData,
    };

    this.alerts.push(alert);
    this.logger.warn(`🚨 SECURITY ALERT: ${alert.title}`, alert.details);

    // Send immediate notifications for high/critical alerts
    if (['HIGH', 'CRITICAL'].includes(alert.severity)) {
      await this.sendImmediateNotification(alert);
    }
  }

  private async sendImmediateNotification(alert: SecurityAlert): Promise<void> {
    const message = this.formatAlertMessage(alert);

    // Send to configured notification channels
    if (this.telegramEnabled) {
      await this.sendTelegramAlert(message);
    }
    
    if (this.webhookEnabled) {
      await this.sendWebhookAlert(alert);
    }
    
    if (this.emailEnabled) {
      await this.sendEmailAlert(alert);
    }

    // Always log to console for immediate visibility
    console.log('\n' + '='.repeat(60));
    console.log('🚨 IMMEDIATE SECURITY ALERT');
    console.log('='.repeat(60));
    console.log(message);
    console.log('='.repeat(60) + '\n');
  }

  private formatAlertMessage(alert: SecurityAlert): string {
    const emoji = {
      'CRITICAL': '🔴',
      'HIGH': '🟠', 
      'MEDIUM': '🟡',
      'LOW': '⚪'
    }[alert.severity];

    return `${emoji} ${alert.severity} SECURITY ALERT
    
📋 ${alert.title}
📝 ${alert.message}
⏰ ${alert.timestamp.toLocaleString()}
🔍 Details: ${JSON.stringify(alert.details, null, 2)}`;
  }

  private async sendTelegramAlert(message: string): Promise<void> {
    try {
      const botToken = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
      const chatId = this.configService.get<string>('ADMIN_TELEGRAM_ID');
      
      if (botToken && chatId) {
        // In a real implementation, use a proper Telegram bot library
        this.logger.log('Would send Telegram alert:', message.substring(0, 100) + '...');
      }
    } catch (error) {
      this.logger.error('Failed to send Telegram alert:', error);
    }
  }

  private async sendWebhookAlert(alert: SecurityAlert): Promise<void> {
    try {
      const webhookUrl = this.configService.get<string>('SECURITY_WEBHOOK_URL');
      
      if (webhookUrl) {
        // In a real implementation, send HTTP POST to webhook
        this.logger.log('Would send webhook alert to:', webhookUrl);
      }
    } catch (error) {
      this.logger.error('Failed to send webhook alert:', error);
    }
  }

  private async sendEmailAlert(alert: SecurityAlert): Promise<void> {
    try {
      const smtpHost = this.configService.get<string>('SMTP_HOST');
      
      if (smtpHost) {
        // In a real implementation, send email via SMTP
        this.logger.log('Would send email alert');
      }
    } catch (error) {
      this.logger.error('Failed to send email alert:', error);
    }
  }

  private async generateSecurityDigest(period: 'day' | 'week' = 'day'): Promise<SecurityDigest> {
    const metrics = this.securityLogger.getSecurityMetrics(period);
    const throttlerStats = this.throttlerService.getSecurityStats();

    const topIssues = Object.entries(metrics.eventsByType)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([type, count]) => ({
        type,
        count,
        description: this.getEventDescription(type),
      }));

    const recommendations = this.generateRecommendations(metrics, throttlerStats);

    return {
      period,
      summary: {
        totalEvents: metrics.totalEvents,
        criticalIssues: metrics.eventsBySeverity['CRITICAL'] || 0,
        newThreats: metrics.uniqueIpsWithIssues,
        blockedAttacks: throttlerStats.blockedIps,
      },
      topIssues,
      recommendations,
    };
  }

  private getEventDescription(eventType: string): string {
    const descriptions: Record<string, string> = {
      'AUTH_FAILURE': 'Failed authentication attempts',
      'RATE_LIMIT_EXCEEDED': 'Rate limiting violations',
      'SUSPICIOUS_ACTIVITY': 'Suspicious behavior patterns',
      'TOKEN_VALIDATION_FAILED': 'Invalid token usage',
      'EMAIL_VERIFICATION_FAILED': 'Email verification issues',
    };
    return descriptions[eventType] || 'Unknown security event';
  }

  private generateRecommendations(metrics: any, throttlerStats: any): string[] {
    const recommendations = [];

    if ((metrics.eventsBySeverity['CRITICAL'] || 0) > 0) {
      recommendations.push('Review and investigate all critical security events immediately');
    }

    if (metrics.uniqueIpsWithIssues > 10) {
      recommendations.push('Consider implementing additional IP blocking or geographic restrictions');
    }

    if ((metrics.eventsByType['AUTH_FAILURE'] || 0) > 50) {
      recommendations.push('Consider implementing CAPTCHA or additional authentication factors');
    }

    if (throttlerStats.blockedIps > 5) {
      recommendations.push('Review blocked IPs to ensure legitimate users are not affected');
    }

    if (recommendations.length === 0) {
      recommendations.push('Security posture is good, continue monitoring');
    }

    return recommendations;
  }

  private async sendDigest(digest: SecurityDigest): Promise<void> {
    const message = `📊 Daily Security Digest
    
📈 Summary:
  • Total Events: ${digest.summary.totalEvents}
  • Critical Issues: ${digest.summary.criticalIssues}
  • New Threats: ${digest.summary.newThreats}
  • Blocked Attacks: ${digest.summary.blockedAttacks}

🔝 Top Issues:
${digest.topIssues.map(issue => `  • ${issue.type}: ${issue.count} (${issue.description})`).join('\n')}

💡 Recommendations:
${digest.recommendations.map(rec => `  • ${rec}`).join('\n')}`;

    this.logger.log('Daily Security Digest:\n' + message);
    
    // Send via configured channels (less urgent than alerts)
    if (this.telegramEnabled) {
      await this.sendTelegramAlert(message);
    }
  }

  private async sendReport(digest: SecurityDigest): Promise<void> {
    this.logger.log(`Weekly Security Report Generated: ${digest.summary.totalEvents} events analyzed`);
    // Implementation for weekly reports (could generate PDF, send detailed email, etc.)
  }

  private cleanupOldAlerts(): void {
    const oneDayAgo = new Date(Date.now() - 86400000);
    const initialLength = this.alerts.length;
    
    // Remove old alerts
    this.alerts.splice(0, this.alerts.length);
    this.alerts.push(...this.alerts.filter(alert => alert.timestamp > oneDayAgo));
    
    if (this.alerts.length !== initialLength) {
      this.logger.debug(`Cleaned up ${initialLength - this.alerts.length} old alerts`);
    }
  }

  /**
   * Public method to get current alerts (for API endpoints)
   */
  getActiveAlerts(): SecurityAlert[] {
    return this.alerts.filter(alert => !alert.resolved);
  }

  /**
   * Public method to resolve an alert
   */
  resolveAlert(alertId: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) {
      alert.resolved = true;
      this.logger.log(`Alert resolved: ${alertId}`);
      return true;
    }
    return false;
  }
}