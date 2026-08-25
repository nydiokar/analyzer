import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger, OnModuleInit } from '@nestjs/common';
import { Request } from 'express';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { JwtDatabaseService } from '../services/jwt-database.service';
import { AuthService } from '../services/auth.service';
import { ApiKeyService, ApiKeyScope } from '../services/api-key.service';
import { JwtKeyRotationService } from '../services/jwt-key-rotation.service';
import { SecurityLoggerService } from '../services/security-logger.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ALLOW_UNVERIFIED_EMAIL_KEY } from '../decorators/allow-unverified.decorator';
import { CREDITS_REQUIRED_KEY } from '../decorators/require-credits.decorator';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';
import { getErrorMessage, getErrorDetails } from '../../../core/utils/error-utils';
import { X402VerificationService } from '../../services/x402-verification.service';


interface AuthenticatedRequest extends Request {
  user?: User;
  apiKeyScopes?: ApiKeyScope[];
  apiKeyInfo?: {
    id?: string;
    prefix?: string;
    description?: string;
    scopes?: ApiKeyScope[];
  };
}

@Injectable()
export class CompositeAuthGuard implements CanActivate {
  private readonly logger = new Logger(CompositeAuthGuard.name);
  private readonly apiKeyCache = new Map<string, {user: User, expiresAt: number}>();
  private readonly jwtCache = new Map<string, {user: User, expiresAt: number}>();
  private readonly JWT_CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds
  private readonly API_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  // Log throttling to prevent spam (track last log time per user/error type)
  private readonly logThrottle = new Map<string, number>();
  private readonly LOG_THROTTLE_MS = 30000; // Only log same error once per 30s

  constructor(
    private readonly databaseService: JwtDatabaseService,
    private readonly authService: AuthService,
    private readonly apiKeyService: ApiKeyService,
    private readonly keyRotationService: JwtKeyRotationService,
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    private readonly x402VerificationService: X402VerificationService,
    // Security logging will be handled at controller level to avoid circular dependencies
  ) {
    this.logger.debug(`CompositeAuthGuard instance created`);
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const allowUnverified = this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_EMAIL_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    // X402 autonomous agent path — v2 PAYMENT-SIGNATURE or legacy X-Payment header
    // No JWT or API key required. Agent is identified by their Solana wallet pubkey.
    const paymentHeader = (request.headers['payment-signature'] ?? request.headers['x-payment']) as string | undefined;
    if (paymentHeader) {
      const walletPubkey = this.x402VerificationService.extractPayerFromHeader(paymentHeader);
      const agentUser = await this.x402VerificationService.findOrCreateAgentUser(walletPubkey);
      request.user = agentUser;
      return true;
    }

    // X402 discovery path — endpoint requires credits but no auth headers present.
    // Allow through unauthenticated so CreditGuard can return the 402 payment
    // instructions payload (the agent's first call to discover how much to pay).
    const requiresCredits = this.reflector.getAllAndOverride<number | undefined>(
      CREDITS_REQUIRED_KEY,
      [context.getHandler(), context.getClass()],
    );
    const hasNoAuth =
      !request.headers.authorization && !request.headers['x-api-key'];
    if (requiresCredits !== undefined && hasNoAuth) {
      // No user set — CreditGuard will detect this and return 402 with payment instructions
      return true;
    }

    // Try JWT authentication first (preferred)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const user = await this.validateJwtToken(token);
        if (user) {
          this.ensureEmailVerified(allowUnverified, request, user);
          request.user = user;
          return true;
        }
      } catch (error) {
        // Email verification required = expected during registration (DEBUG)
        // Invalid/expired tokens = potential security issue (WARN)
        if (error instanceof ForbiddenException) {
          this.throttledLog('debug', 'email-verification', `JWT auth: Email verification required`);
        } else {
          this.throttledLog('warn', 'jwt-invalid', `JWT auth failed: ${error instanceof Error ? error.message : 'Unknown'}`);
        }
        // Continue to API key fallback
      }
    }

    // Fallback to API key authentication
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      try {
        const result = await this.validateApiKey(apiKey);
        if (result && result.user) {
          this.ensureEmailVerified(allowUnverified, request, result.user);
          request.user = result.user;
          request.apiKeyScopes = result.scopes;
          request.apiKeyInfo = result.keyInfo;
          return true;
        }
      } catch (error) {
        // API key validation failures are security-relevant (WARN)
        this.throttledLog('warn', 'api-key-invalid', `API key validation failed`);
      }
    }

    // No valid authentication method found.
    // If this is a credit-gated endpoint, pass through with no user so CreditGuard can
    // issue the 402 payment-required response. This handles x402 agents that send a
    // stale/invalid Authorization header alongside their payment-signature.
    if (requiresCredits !== undefined) {
      return true;
    }

    throw new UnauthorizedException('Authentication required. Log in or verify your account to perform analysis.');
  }

  private async validateJwtToken(token: string): Promise<User | null> {
    try {
      // Check cache first
      const cached = this.jwtCache.get(token);
      if (cached && cached.expiresAt > Date.now()) {
        // Even with cache hit, always validate user is still active
        const freshUser = await this.databaseService.findActiveUserById(cached.user.id);
        if (freshUser && freshUser.isActive) {
          // Update last seen
          await this.authService.updateLastSeen(freshUser.id);
          this.logger.debug(`JWT cache hit for user: ${freshUser.id}`);
          return freshUser;
        } else {
          // User is no longer active, remove from cache
          this.jwtCache.delete(token);
          this.throttledLog('warn', `inactive-user-${cached.user.id}`, `Cached user is no longer active: ${cached.user.id}`);
        }
      }

      // Verify JWT token using key rotation service
      const decoded = this.decodeJwtHeader(token);
      const keyId = decoded?.kid;
      if (decoded?.alg && decoded.alg !== 'HS256') {
        throw new UnauthorizedException('Unsupported JWT algorithm');
      }
      let secret = this.configService.get<string>('JWT_SECRET');
      if (!secret) {
        throw new UnauthorizedException('JWT secret not configured');
      }
      
      if (keyId) {
        const key = this.keyRotationService.getKey(keyId);
        if (key && key.isActive) {
          secret = key.secret;
        }
      }

      const payload = this.jwtService.verify(token, { 
        secret, 
        clockTolerance: 120, 
        ignoreExpiration: false,
        algorithms: ['HS256'],
      });

      if (!payload.sub || !payload.email) {
        throw new UnauthorizedException('Invalid token payload');
      }
      // Validate issuer/audience if present
      const expectedIssuer = this.configService.get<string>('JWT_ISSUER') || 'analyzer-api';
      const expectedAudience = this.configService.get<string>('JWT_AUDIENCE') || 'analyzer-client';
      if (payload.iss && payload.iss !== expectedIssuer) {
        throw new UnauthorizedException('Invalid token issuer');
      }
      if (payload.aud && payload.aud !== expectedAudience) {
        throw new UnauthorizedException('Invalid token audience');
      }

      // Get user from database
      const user = await this.authService.validateUserById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found or inactive');
      }

      // Update last seen
      await this.authService.updateLastSeen(user.id);

      // Cache the result with TTL
      this.jwtCache.set(token, {
        user,
        expiresAt: Date.now() + this.JWT_CACHE_TTL
      });

      // Clean cache if it gets too large
      this.cleanCacheIfNeeded();

      return user;
    } catch (error) {
      // Remove invalid token from cache
      this.jwtCache.delete(token);
      
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token has expired');
      } else if (error instanceof Error && error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid token');
      }
      throw new UnauthorizedException('Token validation failed');
    }
  }

  private async validateApiKey(apiKey: string): Promise<{ user: User; scopes: ApiKeyScope[]; keyInfo?: AuthenticatedRequest['apiKeyInfo'] } | null> {
    try {
      // Use the new API key service for validation
      const result = await this.apiKeyService.validateApiKey(apiKey);
      
      if (!result.isValid || !result.user) {
        throw new UnauthorizedException('Invalid or inactive API key');
      }

      return {
        user: result.user,
        scopes: result.scopes || [],
        keyInfo: result.keyInfo,
      };
    } catch (error) {
      // Don't log here - already logged in canActivate with throttling
      throw new UnauthorizedException('API key validation failed');
    }
  }

  private ensureEmailVerified(
    allowUnverified: boolean | undefined,
    request: Request,
    user: User,
  ) {
    if (!allowUnverified && !user.emailVerified) {
      // No logging - this is expected during registration flow
      throw new ForbiddenException({
        message: 'Please verify your email address to continue.',
        code: 'EMAIL_VERIFICATION_REQUIRED',
      });
    }
  }

  // Clean cache when needed to prevent memory leaks and remove expired entries
  private cleanCacheIfNeeded() {
    const now = Date.now();
    
    // Clean expired JWT cache entries
    for (const [token, entry] of this.jwtCache.entries()) {
      if (entry.expiresAt <= now) {
        this.jwtCache.delete(token);
      }
    }
    
    // Clean expired API key cache entries
    for (const [apiKey, entry] of this.apiKeyCache.entries()) {
      if (entry.expiresAt <= now) {
        this.apiKeyCache.delete(apiKey);
      }
    }

    // If cache is still too large, clear all
    if (this.jwtCache.size > 1000) {
      this.logger.log('JWT cache size limit exceeded, clearing all entries');
      this.jwtCache.clear();
    }
    if (this.apiKeyCache.size > 1000) {
      this.logger.log('API key cache size limit exceeded, clearing all entries');
      this.apiKeyCache.clear();
    }
  }

  /**
   * Throttled logging to prevent spam - only log once per LOG_THROTTLE_MS per key
   */
  private throttledLog(level: 'warn' | 'debug', key: string, message: string): void {
    const now = Date.now();
    const lastLog = this.logThrottle.get(key);

    if (!lastLog || now - lastLog > this.LOG_THROTTLE_MS) {
      this.logThrottle.set(key, now);

      if (level === 'warn') {
        this.logger.warn(message);
      } else {
        this.logger.debug(message);
      }
    }
  }

  private decodeJwtHeader(token: string): any {
    try {
      const headerB64 = token.split('.')[0];
      const headerJson = Buffer.from(headerB64, 'base64url').toString();
      return JSON.parse(headerJson);
    } catch (error) {
      this.throttledLog('warn', 'jwt-decode-error', `Failed to decode JWT header: ${getErrorMessage(error)}`);
      return null;
    }
  }

  // Method to forcibly clear caches (useful for testing or security incidents)
  clearAllCaches() {
    this.jwtCache.clear();
    this.apiKeyCache.clear();
    this.logger.log('All authentication caches cleared');
  }

  /**
   * Event listener for cache invalidation events
   * Listens to: 'auth.cache.invalidate'
   * Triggered by: API key revocation/deletion, password changes
   */
  @OnEvent('auth.cache.invalidate')
  handleCacheInvalidation(payload: { reason: string; userId?: string; keyId?: string; prefix?: string }) {
    this.clearAllCaches();

    // Build a clean context object with only defined fields
    const context: Record<string, string> = {};
    if (payload.userId) context.userId = payload.userId;
    if (payload.keyId) context.keyId = payload.keyId;
    if (payload.prefix) context.prefix = payload.prefix;

    this.logger.warn(`SECURITY: Authentication caches cleared. Reason: ${payload.reason}`,
      Object.keys(context).length > 0 ? context : undefined
    );
  }
}
