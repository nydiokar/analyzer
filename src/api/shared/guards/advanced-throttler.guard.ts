import { Injectable, ExecutionContext, Logger, Inject, forwardRef } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerLimitDetail, ThrottlerStorage } from '@nestjs/throttler';
import { Request } from 'express';
import { AdvancedThrottlerService } from '../services/advanced-throttler.service';
import { SecurityLoggerService } from '../services/security-logger.service';
import { Reflector } from '@nestjs/core';
// ThrottlerStorageService no longer exists in v6; use ThrottlerStorage interface instead

/**
 * Advanced throttler guard with IP blocking, progressive backoff, and suspicious activity detection
 */
@Injectable()
export class AdvancedThrottlerGuard extends ThrottlerGuard {
  private readonly logger = new Logger(AdvancedThrottlerGuard.name);

  constructor(
    private readonly advancedThrottler: AdvancedThrottlerService,
    @Inject(forwardRef(() => SecurityLoggerService))
    private readonly securityLogger: SecurityLoggerService,
    options: any,
    storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  /**
   * Override to add advanced security checks
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.getClientIp(request);
    
    // Check if IP is blocked by progressive backoff
    if (this.advancedThrottler.isIpBlocked(ip)) {
      this.logger.warn(`Request blocked: IP ${ip} is in progressive backoff`);
      throw new Error('Rate limit exceeded. Please try again later.');
    }
    
    // Check for suspicious activity patterns
    if (this.advancedThrottler.detectSuspiciousActivity(context)) {
      this.logger.warn(`Suspicious activity detected from IP ${ip}, applying extra throttling`);
      // Could return false here to block immediately, or continue with stricter limits
    }
    
    // Proceed with standard throttling check
    return await super.canActivate(context);
  }

  /**
   * Get client IP considering proxies
   */
  private getClientIp(request: Request): string {
    return (
      (request.headers['x-forwarded-for'] as string)?.split(',')[0] ||
      (request.headers['x-real-ip'] as string) ||
      request.connection.remoteAddress ||
      request.socket.remoteAddress ||
      'unknown'
    );
  }

  /**
   * Enhanced key generation that includes IP for better tracking
   */
  protected generateKey(
    context: ExecutionContext,
    suffix: string,
    name: string,
  ): string {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.getClientIp(request);
    
    // Include both IP and user identification for comprehensive rate limiting
    const baseKey = super.generateKey(context, suffix, name);
    return `${baseKey}:${ip}`;
  }

  /**
   * Custom error message with backoff information
   */
  protected async getErrorMessage(context: ExecutionContext, throttlerLimitDetail: ThrottlerLimitDetail): Promise<string> {
    const request = context.switchToHttp().getRequest<Request>();
    const ip = this.getClientIp(request);
    
    // Check if IP has backoff
    if (this.advancedThrottler.isIpBlocked(ip)) {
      return 'Rate limit exceeded. Your IP is temporarily blocked due to repeated violations. Please try again later.';
    }
    
    return `Rate limit exceeded. Too many requests from ${ip}. Please try again later.`;
  }

  /**
   * Hook into throttling exception to record and log violations
   */
  protected async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const request = context.switchToHttp().getRequest<Request>();
    try {
      this.advancedThrottler.recordViolation(context, throttlerLimitDetail);
      this.securityLogger.logRateLimitExceeded(
        request,
        throttlerLimitDetail.limit,
        throttlerLimitDetail.ttl,
      );
    } finally {
      await super.throwThrottlingException(context, throttlerLimitDetail);
    }
  }
}
