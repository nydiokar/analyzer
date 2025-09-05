import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { JwtDatabaseService } from '../services/jwt-database.service';
import { AuthService } from '../services/auth.service';
import { ApiKeyService, ApiKeyScope } from '../services/api-key.service';
import { JwtKeyRotationService } from '../services/jwt-key-rotation.service';
import { SecurityLoggerService } from '../services/security-logger.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';

interface AuthenticatedRequest extends Request {
  user?: User;
  apiKeyScopes?: ApiKeyScope[];
}

@Injectable()
export class CompositeAuthGuard implements CanActivate {
  private readonly logger = new Logger(CompositeAuthGuard.name);
  private readonly demoWallets: string[];
  private readonly apiKeyCache = new Map<string, {user: User, expiresAt: number}>();
  private readonly jwtCache = new Map<string, {user: User, expiresAt: number}>();
  private readonly JWT_CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds
  private readonly API_KEY_CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

  constructor(
    private readonly databaseService: JwtDatabaseService,
    private readonly authService: AuthService,
    private readonly apiKeyService: ApiKeyService,
    private readonly keyRotationService: JwtKeyRotationService,
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
    // Security logging will be handled at controller level to avoid circular dependencies
  ) {
    const demoWalletsFromEnv = this.configService.get<string>('DEMO_WALLETS');
    this.demoWallets = demoWalletsFromEnv ? demoWalletsFromEnv.split(',').map(w => w.trim()) : [];
    if (this.demoWallets.length > 0) {
      this.logger.log(`Initialized with ${this.demoWallets.length} demo wallets.`);
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    
    // Try JWT authentication first (preferred)
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const user = await this.validateJwtToken(token);
        if (user) {
          request.user = user;
          this.checkDemoPermissions(request, user);
          // Security logging handled at controller level
          this.logger.debug(`User ${user.id} authenticated via JWT`);
          return true;
        }
      } catch (error) {
        // Security logging handled at controller level
        this.logger.warn(`JWT authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue to API key fallback
      }
    }

    // Fallback to API key authentication
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      try {
        const result = await this.validateApiKey(apiKey);
        if (result && result.user) {
          request.user = result.user;
          request.apiKeyScopes = result.scopes;
          this.checkDemoPermissions(request, result.user);
          // Security logging handled at controller level
          this.logger.debug(`User ${result.user.id} authenticated via API key with scopes: ${result.scopes?.join(', ')}`);
          return true;
        }
      } catch (error) {
        // Security logging handled at controller level
        this.logger.warn(`API key authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // No valid authentication method found
    // Security logging handled at controller level
    this.logger.warn('No valid authentication provided');
    throw new UnauthorizedException('Authentication required. Provide either a Bearer token or X-API-Key header.');
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
          this.logger.warn(`Cached user is no longer active, removed from cache: ${cached.user.id}`);
        }
      }

      // Verify JWT token using key rotation service
      const decoded = this.decodeJwtHeader(token);
      const keyId = decoded?.kid;
      let secret = this.configService.get<string>('JWT_SECRET');
      
      if (keyId) {
        const key = this.keyRotationService.getKey(keyId);
        if (key && key.isActive) {
          secret = key.secret;
        }
      }

      const payload = this.jwtService.verify(token, { secret, clockTolerance: 120, ignoreExpiration: false });

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

  private async validateApiKey(apiKey: string): Promise<{ user: User; scopes: ApiKeyScope[] } | null> {
    try {
      // Use the new API key service for validation
      const result = await this.apiKeyService.validateApiKey(apiKey);
      
      if (!result.isValid || !result.user) {
        throw new UnauthorizedException('Invalid or inactive API key');
      }

      return {
        user: result.user,
        scopes: result.scopes || []
      };
    } catch (error) {
      this.logger.warn(`Enhanced API key validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw new UnauthorizedException('API key validation failed');
    }
  }

  private checkDemoPermissions(request: Request, user: User) {
    if (user.isDemo) {
      this.logger.debug(`User ${user.id} is a demo user. Applying restrictions.`);
      
      const walletAddress = request.params.walletAddress;

      // RULE 1: If accessing a specific wallet, it must be in the demo list.
      if (walletAddress && !this.demoWallets.includes(walletAddress)) {
        this.logger.warn(`Demo user ${user.id} attempting to access non-demo wallet ${walletAddress}.`);
        throw new ForbiddenException('This wallet is not available in the Demo account.');
      }

      const isFavoritesRoute = request.path.includes('/users/me/favorites');
      const isNotesRoute = request.path.includes('/notes');

      // RULE 2: Demo users can manage favorites.
      if (isFavoritesRoute && (request.method === 'POST' || request.method === 'DELETE')) {
          this.logger.verbose(`Demo user ${user.id} allowed favorite management action: ${request.method}`);
      } 
      // RULE 3: Demo users cannot perform write actions on notes.
      else if (isNotesRoute && request.method !== 'GET') {
        this.logger.warn(`Demo user ${user.id} blocked from performing a ${request.method} action on notes route: ${request.path}`);
        throw new ForbiddenException('Adding, editing, or deleting notes is not available for demo accounts.');
      }
      // RULE 4: For all other routes, block general write actions.
      else if (request.method !== 'GET') {
        this.logger.warn(`Demo user ${user.id} blocked from performing a ${request.method} action on path: ${request.path}`);
        throw new ForbiddenException('The demo account is read-only and cannot perform this action.');
      }
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

  private decodeJwtHeader(token: string): any {
    try {
      const headerB64 = token.split('.')[0];
      const headerJson = Buffer.from(headerB64, 'base64url').toString();
      return JSON.parse(headerJson);
    } catch (error) {
      this.logger.warn('Failed to decode JWT header:', error);
      return null;
    }
  }

  // Method to forcibly clear caches (useful for testing or security incidents)
  clearAllCaches() {
    this.jwtCache.clear();
    this.apiKeyCache.clear();
    this.logger.log('All authentication caches cleared');
  }
}