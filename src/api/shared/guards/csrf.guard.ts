import { Injectable, CanActivate, ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { CsrfService } from '../services/csrf.service';

@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);
  private readonly cookieMode: boolean;

  constructor(
    private readonly csrfService: CsrfService,
    private readonly configService: ConfigService,
  ) {
    this.cookieMode = this.configService.get<string>('AUTH_COOKIE_MODE') === 'true';
  }

  canActivate(context: ExecutionContext): boolean {
    // Only apply CSRF protection when cookie mode is enabled
    if (!this.cookieMode) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    
    // Skip CSRF for safe methods (GET, HEAD, OPTIONS)
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
      return true;
    }

    // Extract CSRF token from headers
    const csrfToken = this.csrfService.extractTokenFromHeaders(request.headers);
    
    if (!csrfToken) {
      this.logger.warn(`CSRF token missing for ${request.method} ${request.path}`);
      throw new ForbiddenException('CSRF token required');
    }

    // Extract session ID from request if available (from refresh token or user context)
    const sessionId = this.extractSessionId(request);
    
    // Validate CSRF token
    const isValid = this.csrfService.validateCsrfToken(csrfToken, sessionId);
    
    if (!isValid) {
      this.logger.warn(`CSRF token validation failed for ${request.method} ${request.path}`);
      throw new ForbiddenException('Invalid CSRF token');
    }

    return true;
  }

  private extractSessionId(request: Request): string | undefined {
    // Try to extract session ID from request body if it contains refresh_token
    if (request.body && request.body.refresh_token) {
      // In a real implementation, you might want to decode the refresh token to get session ID
      // For now, we'll rely on the token validation itself
      return undefined;
    }

    // Try to extract from user context if authenticated
    if ((request as any).user?.id) {
      return (request as any).user.id;
    }

    return undefined;
  }
}