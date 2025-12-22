import { Injectable, Logger } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail } from '@nestjs/throttler';
import { ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

interface RateLimitAttempt {
  count: number;
  firstAttempt: Date;
  lastAttempt: Date;
  blocked: boolean;
  blockUntil?: Date;
}

interface SecurityEvent {
  ip: string;
  endpoint: string;
  timestamp: Date;
  eventType: 'RATE_LIMIT_EXCEEDED' | 'PROGRESSIVE_BACKOFF' | 'SUSPICIOUS_PATTERN';
  details: any;
}

@Injectable()
export class AdvancedThrottlerService {
  private readonly logger = new Logger(AdvancedThrottlerService.name);
  
  // Track failed attempts by IP
  private ipAttempts = new Map<string, RateLimitAttempt>();
  
  // Track suspicious patterns
  private securityEvents: SecurityEvent[] = [];
  
  // Progressive backoff multipliers
  private readonly BACKOFF_MULTIPLIERS = [1, 2, 4, 8, 16, 32]; // minutes
  private readonly MAX_BACKOFF_MINUTES = 60;
  
  /**
   * Get client IP address from request
   */
  private getClientIp(request: Request): string {
    // Handle various proxy scenarios
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (request.headers['x-real-ip'] as string) ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Record a rate limit violation
   */
  recordViolation(context: ExecutionContext, limit: ThrottlerLimitDetail): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.getClientIp(request);
    const endpoint = `${request.method} ${request.path}`;
    
    const now = new Date();
    let attempt = this.ipAttempts.get(ip);
    
    if (!attempt) {
      attempt = {
        count: 1,
        firstAttempt: now,
        lastAttempt: now,
        blocked: false,
      };
    } else {
      attempt.count++;
      attempt.lastAttempt = now;
    }
    
    this.ipAttempts.set(ip, attempt);
    
    // Log security event
    this.recordSecurityEvent({
      ip,
      endpoint,
      timestamp: now,
      eventType: 'RATE_LIMIT_EXCEEDED',
      details: {
        attemptCount: attempt.count,
        limit: limit.limit,
        ttl: limit.ttl,
        userAgent: request.headers['user-agent'],
      },
    });
    
    // Check if we should apply progressive backoff
    if (attempt.count >= 3) {
      return this.applyProgressiveBackoff(ip, attempt, endpoint);
    }
    
    return false; // No additional blocking
  }

  /**
   * Apply progressive backoff for repeated violations
   */
  private applyProgressiveBackoff(ip: string, attempt: RateLimitAttempt, endpoint: string): boolean {
    const backoffLevel = Math.min(attempt.count - 3, this.BACKOFF_MULTIPLIERS.length - 1);
    const backoffMinutes = Math.min(
      this.BACKOFF_MULTIPLIERS[backoffLevel],
      this.MAX_BACKOFF_MINUTES
    );
    
    const blockUntil = new Date(Date.now() + backoffMinutes * 60 * 1000);
    
    attempt.blocked = true;
    attempt.blockUntil = blockUntil;
    
    this.logger.warn(`Progressive backoff applied to IP ${ip}: blocked for ${backoffMinutes} minutes`);
    
    this.recordSecurityEvent({
      ip,
      endpoint,
      timestamp: new Date(),
      eventType: 'PROGRESSIVE_BACKOFF',
      details: {
        backoffLevel,
        backoffMinutes,
        blockUntil,
        totalAttempts: attempt.count,
      },
    });
    
    return true;
  }

  /**
   * Check if IP is currently blocked
   */
  isIpBlocked(ip: string): boolean {
    const attempt = this.ipAttempts.get(ip);
    if (!attempt || !attempt.blocked || !attempt.blockUntil) {
      return false;
    }
    
    if (new Date() > attempt.blockUntil) {
      // Backoff period expired, reset
      attempt.blocked = false;
      attempt.blockUntil = undefined;
      // Reduce count by half to give some grace but maintain awareness
      attempt.count = Math.floor(attempt.count / 2);
      return false;
    }
    
    return true;
  }

  /**
   * Check for suspicious patterns
   */
  detectSuspiciousActivity(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.getClientIp(request);
    const now = new Date();
    const oneMinuteAgo = new Date(now.getTime() - 60000);
    
    // Count recent events from this IP
    const recentEvents = this.securityEvents.filter(
      event => event.ip === ip && event.timestamp > oneMinuteAgo
    );
    
    // Check for rapid-fire requests to different endpoints
    const uniqueEndpoints = new Set(recentEvents.map(e => e.endpoint)).size;
    
    if (recentEvents.length > 20 || uniqueEndpoints > 10) {
      this.logger.warn(`Suspicious activity detected from IP ${ip}: ${recentEvents.length} events, ${uniqueEndpoints} unique endpoints in 1 minute`);
      
      this.recordSecurityEvent({
        ip,
        endpoint: `${request.method} ${request.path}`,
        timestamp: now,
        eventType: 'SUSPICIOUS_PATTERN',
        details: {
          recentEventCount: recentEvents.length,
          uniqueEndpoints,
          pattern: 'rapid_multi_endpoint_access',
        },
      });
      
      return true;
    }
    
    return false;
  }

  /**
   * Record security event for monitoring
   */
  private recordSecurityEvent(event: SecurityEvent): void {
    this.securityEvents.push(event);
    
    // Keep only last 1000 events to prevent memory bloat
    if (this.securityEvents.length > 1000) {
      this.securityEvents = this.securityEvents.slice(-1000);
    }
    
    // Log critical events
    if (event.eventType === 'SUSPICIOUS_PATTERN') {
      this.logger.error(`SECURITY: Suspicious pattern detected`, {
        ip: event.ip,
        endpoint: event.endpoint,
        details: event.details,
      });
    }
  }

  /**
   * Get security statistics for monitoring
   */
  getSecurityStats(): {
    blockedIps: number;
    recentEvents: number;
    topViolatingIps: Array<{ip: string; violations: number}>;
  } {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    
    const blockedIps = Array.from(this.ipAttempts.values()).filter(
      attempt => attempt.blocked && attempt.blockUntil && attempt.blockUntil > now
    ).length;
    
    const recentEvents = this.securityEvents.filter(
      event => event.timestamp > oneHourAgo
    ).length;
    
    // Count violations by IP
    const ipViolations = new Map<string, number>();
    this.securityEvents
      .filter(event => event.timestamp > oneHourAgo)
      .forEach(event => {
        ipViolations.set(event.ip, (ipViolations.get(event.ip) || 0) + 1);
      });
    
    const topViolatingIps = Array.from(ipViolations.entries())
      .map(([ip, violations]) => ({ ip, violations }))
      .sort((a, b) => b.violations - a.violations)
      .slice(0, 10);
    
    return {
      blockedIps,
      recentEvents,
      topViolatingIps,
    };
  }

  /**
   * Cleanup old data periodically
   */
  cleanup(): void {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 3600000);
    
    // Clean up old attempts
    for (const [ip, attempt] of this.ipAttempts.entries()) {
      if (attempt.lastAttempt < oneHourAgo && !attempt.blocked) {
        this.ipAttempts.delete(ip);
      }
    }
    
    // Clean up old security events
    this.securityEvents = this.securityEvents.filter(
      event => event.timestamp > oneHourAgo
    );
    
    this.logger.debug('Advanced throttler cleanup completed');
  }
}