import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

export interface SecurityEvent {
  eventType: 
    | 'AUTH_SUCCESS' 
    | 'AUTH_FAILURE' 
    | 'TOKEN_VALIDATION_FAILED'
    | 'EMAIL_VERIFICATION_ATTEMPT'
    | 'EMAIL_VERIFICATION_SUCCESS'
    | 'EMAIL_VERIFICATION_FAILED'
    | 'RATE_LIMIT_EXCEEDED'
    | 'SUSPICIOUS_ACTIVITY'
    | 'ACCOUNT_LOCKOUT'
    | 'PASSWORD_CHANGE'
    | 'UNAUTHORIZED_ACCESS_ATTEMPT'
    | 'JWT_TOKEN_TAMPERING'
    | 'API_KEY_MISUSE'
    | 'CACHE_POISONING_ATTEMPT';
    
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  userId?: string;
  sessionId?: string;
  ip: string;
  userAgent?: string;
  endpoint: string;
  method: string;
  timestamp: Date;
  details: Record<string, any>;
  riskScore?: number;
}

export interface SecurityMetrics {
  totalEvents: number;
  eventsBySeverity: Record<string, number>;
  eventsByType: Record<string, number>;
  uniqueIpsWithIssues: number;
  recentSuspiciousActivity: SecurityEvent[];
  topRiskIps: Array<{ip: string; riskScore: number; eventCount: number}>;
}

@Injectable()
export class SecurityLoggerService {
  private readonly logger = new Logger(SecurityLoggerService.name);
  private readonly events: SecurityEvent[] = [];
  private readonly maxEventsInMemory = 5000;
  private readonly isProductionMode: boolean;

  constructor(private readonly configService: ConfigService) {
    this.isProductionMode = this.configService.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Log a security event
   */
  logSecurityEvent(event: Omit<SecurityEvent, 'timestamp'>): void {
    const fullEvent: SecurityEvent = {
      ...event,
      timestamp: new Date(),
    };

    // Store in memory for analysis
    this.events.push(fullEvent);
    this.trimEventsIfNeeded();

    // Log based on severity
    const logMessage = this.formatSecurityLog(fullEvent);
    
    switch (fullEvent.severity) {
      case 'CRITICAL':
        this.logger.error(`🚨 CRITICAL SECURITY EVENT: ${logMessage}`, {
          event: fullEvent,
          alert: true,
        });
        // In production, this could trigger alerts/notifications
        break;
        
      case 'HIGH':
        this.logger.warn(`⚠️  HIGH SECURITY EVENT: ${logMessage}`, {
          event: fullEvent,
        });
        break;
        
      case 'MEDIUM':
        this.logger.warn(`🔍 MEDIUM SECURITY EVENT: ${logMessage}`, {
          event: fullEvent,
        });
        break;
        
      case 'LOW':
        this.logger.log(`📝 LOW SECURITY EVENT: ${logMessage}`, {
          event: fullEvent,
        });
        break;
    }

    // Send to external monitoring in production
    if (this.isProductionMode && ['CRITICAL', 'HIGH'].includes(fullEvent.severity)) {
      this.sendToExternalMonitoring(fullEvent);
    }
  }

  /**
   * Log authentication success
   */
  logAuthSuccess(req: Request, userId: string, method: 'JWT' | 'API_KEY'): void {
    this.logSecurityEvent({
      eventType: 'AUTH_SUCCESS',
      severity: 'LOW',
      userId,
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
      method: req.method,
      details: {
        authMethod: method,
        success: true,
      },
    });
  }

  /**
   * Log authentication failure
   */
  logAuthFailure(req: Request, reason: string, userId?: string): void {
    this.logSecurityEvent({
      eventType: 'AUTH_FAILURE',
      severity: 'MEDIUM',
      userId,
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
      method: req.method,
      details: {
        reason,
        potentialAttack: this.detectPotentialAttack(req, reason),
      },
      riskScore: this.calculateRiskScore(req, reason),
    });
  }

  /**
   * Log token validation failure
   */
  logTokenValidationFailed(req: Request, tokenType: 'JWT' | 'API_KEY', reason: string): void {
    this.logSecurityEvent({
      eventType: 'TOKEN_VALIDATION_FAILED',
      severity: 'MEDIUM',
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
      method: req.method,
      details: {
        tokenType,
        reason,
        suspiciousTampering: reason.includes('invalid') || reason.includes('malformed'),
      },
      riskScore: this.calculateRiskScore(req, reason),
    });
  }

  /**
   * Log email verification attempts
   */
  logEmailVerificationAttempt(req: Request, userId: string, success: boolean, reason?: string): void {
    this.logSecurityEvent({
      eventType: success ? 'EMAIL_VERIFICATION_SUCCESS' : 'EMAIL_VERIFICATION_FAILED',
      severity: success ? 'LOW' : 'MEDIUM',
      userId,
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
      method: req.method,
      details: {
        success,
        reason: reason || 'N/A',
        multipleAttempts: this.hasMultipleRecentAttempts(userId, 'EMAIL_VERIFICATION_ATTEMPT'),
      },
    });
  }

  /**
   * Log rate limit exceeded
   */
  logRateLimitExceeded(req: Request, limit: number, ttl: number): void {
    this.logSecurityEvent({
      eventType: 'RATE_LIMIT_EXCEEDED',
      severity: 'MEDIUM',
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
      method: req.method,
      details: {
        limit,
        ttl,
        endpoint: req.path,
        repeated: this.hasRepeatedRateLimitViolations(this.extractIp(req)),
      },
      riskScore: this.calculateRiskScore(req, 'rate_limit'),
    });
  }

  /**
   * Log suspicious activity
   */
  logSuspiciousActivity(req: Request, pattern: string, details: Record<string, any>): void {
    this.logSecurityEvent({
      eventType: 'SUSPICIOUS_ACTIVITY',
      severity: 'HIGH',
      ip: this.extractIp(req),
      userAgent: req.headers['user-agent'],
      endpoint: req.path,
      method: req.method,
      details: {
        pattern,
        ...details,
        automated: this.detectAutomatedBehavior(req),
      },
      riskScore: this.calculateRiskScore(req, pattern),
    });
  }

  /**
   * Get security metrics for monitoring dashboard
   */
  getSecurityMetrics(timeRange: 'hour' | 'day' | 'week' = 'hour'): SecurityMetrics {
    const cutoffTime = this.getCutoffTime(timeRange);
    const recentEvents = this.events.filter(event => event.timestamp > cutoffTime);

    const eventsBySeverity: Record<string, number> = {};
    const eventsByType: Record<string, number> = {};
    const ipRiskScores = new Map<string, {total: number; count: number}>();

    recentEvents.forEach(event => {
      // Count by severity
      eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] || 0) + 1;
      
      // Count by type
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;
      
      // Calculate IP risk scores
      if (event.riskScore) {
        const existing = ipRiskScores.get(event.ip) || {total: 0, count: 0};
        ipRiskScores.set(event.ip, {
          total: existing.total + event.riskScore,
          count: existing.count + 1,
        });
      }
    });

    const uniqueIpsWithIssues = new Set(
      recentEvents
        .filter(event => ['MEDIUM', 'HIGH', 'CRITICAL'].includes(event.severity))
        .map(event => event.ip)
    ).size;

    const topRiskIps = Array.from(ipRiskScores.entries())
      .map(([ip, {total, count}]) => ({
        ip,
        riskScore: Math.round(total / count),
        eventCount: count,
      }))
      .sort((a, b) => b.riskScore - a.riskScore)
      .slice(0, 10);

    const recentSuspiciousActivity = recentEvents
      .filter(event => ['HIGH', 'CRITICAL'].includes(event.severity))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, 20);

    return {
      totalEvents: recentEvents.length,
      eventsBySeverity,
      eventsByType,
      uniqueIpsWithIssues,
      recentSuspiciousActivity,
      topRiskIps,
    };
  }

  /**
   * Helper methods
   */
  private extractIp(req: Request): string {
    return (
      (req.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (req.headers['x-real-ip'] as string) ||
      req.connection?.remoteAddress ||
      'unknown'
    );
  }

  private formatSecurityLog(event: SecurityEvent): string {
    return `${event.eventType} from ${event.ip} on ${event.endpoint} (${event.userId || 'anonymous'})`;
  }

  private trimEventsIfNeeded(): void {
    if (this.events.length > this.maxEventsInMemory) {
      this.events.splice(0, this.events.length - this.maxEventsInMemory);
    }
  }

  private calculateRiskScore(req: Request, context: string): number {
    let score = 1;
    
    // Increase score based on context
    if (context.includes('invalid') || context.includes('malformed')) score += 3;
    if (context.includes('repeated') || context.includes('multiple')) score += 2;
    if (context === 'rate_limit') score += 2;
    
    // Check user agent
    const userAgent = req.headers['user-agent'] || '';
    if (!userAgent || userAgent.length < 10) score += 2;
    if (userAgent.toLowerCase().includes('bot') || userAgent.toLowerCase().includes('curl')) score += 3;
    
    // Time-based patterns (unusual hours might be suspicious)
    const hour = new Date().getHours();
    if (hour < 6 || hour > 22) score += 1; // Late night/early morning activity
    
    return Math.min(score, 10); // Cap at 10
  }

  private detectPotentialAttack(req: Request, reason: string): boolean {
    const suspiciousPatterns = [
      'brute force',
      'multiple attempts',
      'invalid token',
      'malformed request',
    ];
    
    return suspiciousPatterns.some(pattern => reason.toLowerCase().includes(pattern));
  }

  private detectAutomatedBehavior(req: Request): boolean {
    const userAgent = (req.headers['user-agent'] || '').toLowerCase();
    const automatedIndicators = [
      'bot', 'crawler', 'spider', 'scraper', 'curl', 'wget', 'python', 'http',
    ];
    
    return automatedIndicators.some(indicator => userAgent.includes(indicator));
  }

  private hasMultipleRecentAttempts(userId: string, eventType: string): boolean {
    const oneHourAgo = new Date(Date.now() - 3600000);
    const recentAttempts = this.events.filter(
      event => event.userId === userId && 
               event.eventType === eventType && 
               event.timestamp > oneHourAgo
    );
    
    return recentAttempts.length > 3;
  }

  private hasRepeatedRateLimitViolations(ip: string): boolean {
    const oneHourAgo = new Date(Date.now() - 3600000);
    const violations = this.events.filter(
      event => event.ip === ip && 
               event.eventType === 'RATE_LIMIT_EXCEEDED' && 
               event.timestamp > oneHourAgo
    );
    
    return violations.length > 5;
  }

  private getCutoffTime(timeRange: 'hour' | 'day' | 'week'): Date {
    const now = Date.now();
    switch (timeRange) {
      case 'hour':
        return new Date(now - 3600000);
      case 'day':
        return new Date(now - 86400000);
      case 'week':
        return new Date(now - 604800000);
      default:
        return new Date(now - 3600000);
    }
  }

  private sendToExternalMonitoring(event: SecurityEvent): void {
    // In a real implementation, this would send to external services like:
    // - Slack/Discord notifications
    // - Email alerts
    // - SIEM systems
    // - Monitoring dashboards
    // - Security incident management platforms
    
    this.logger.log(`Would send to external monitoring: ${event.eventType} (${event.severity})`);
  }
}