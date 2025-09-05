import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class CsrfService {
  private readonly logger = new Logger(CsrfService.name);
  private readonly csrfSecret: string;
  
  constructor(private readonly configService: ConfigService) {
    this.csrfSecret = this.configService.get<string>('CSRF_SECRET') || this.generateSecret();
    if (!this.configService.get<string>('CSRF_SECRET')) {
      this.logger.warn('CSRF_SECRET not set in environment variables. Using generated secret (not recommended for production)');
    }
  }

  /**
   * Generate a CSRF token for a session
   */
  generateCsrfToken(sessionId?: string): string {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(16).toString('hex');
    const payload = `${sessionId || 'anonymous'}:${timestamp}:${random}`;
    
    const signature = this.signPayload(payload);
    return Buffer.from(`${payload}:${signature}`).toString('base64url');
  }

  /**
   * Validate a CSRF token
   */
  validateCsrfToken(token: string, sessionId?: string, maxAge: number = 3600000): boolean { // 1 hour default
    try {
      if (!token) {
        return false;
      }

      const decoded = Buffer.from(token, 'base64url').toString();
      const parts = decoded.split(':');
      
      if (parts.length !== 4) {
        this.logger.warn('Invalid CSRF token format');
        return false;
      }

      const [tokenSessionId, timestamp, random, signature] = parts;
      const payload = `${tokenSessionId}:${timestamp}:${random}`;
      
      // Verify signature
      const expectedSignature = this.signPayload(payload);
      if (!this.constantTimeCompare(signature, expectedSignature)) {
        this.logger.warn('CSRF token signature validation failed');
        return false;
      }

      // Verify session ID matches if provided
      if (sessionId && tokenSessionId !== sessionId && tokenSessionId !== 'anonymous') {
        this.logger.warn('CSRF token session ID mismatch');
        return false;
      }

      // Check token age
      const tokenTime = parseInt(timestamp, 10);
      if (Date.now() - tokenTime > maxAge) {
        this.logger.warn('CSRF token expired');
        return false;
      }

      return true;
    } catch (error) {
      this.logger.error('CSRF token validation error:', error);
      return false;
    }
  }

  /**
   * Get CSRF token from request headers
   */
  extractTokenFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
    const headerValue = headers['x-csrf-token'] || headers['X-CSRF-Token'];
    return Array.isArray(headerValue) ? headerValue[0] : headerValue || null;
  }

  private signPayload(payload: string): string {
    return crypto
      .createHmac('sha256', this.csrfSecret)
      .update(payload)
      .digest('hex');
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }
    
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    
    return result === 0;
  }

  private generateSecret(): string {
    return crypto.randomBytes(32).toString('hex');
  }
}