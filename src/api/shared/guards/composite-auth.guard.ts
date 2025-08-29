import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { JwtDatabaseService } from '../services/jwt-database.service';
import { AuthService } from '../services/auth.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';
import { JwtService } from '@nestjs/jwt';

interface AuthenticatedRequest extends Request {
  user?: User;
}

@Injectable()
export class CompositeAuthGuard implements CanActivate {
  private readonly logger = new Logger(CompositeAuthGuard.name);
  private readonly demoWallets: string[];
  private readonly apiKeyCache = new Map<string, User>();
  private readonly jwtCache = new Map<string, User>();

  constructor(
    private readonly databaseService: JwtDatabaseService,
    private readonly authService: AuthService,
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
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
          this.logger.debug(`User ${user.id} authenticated via JWT`);
          return true;
        }
      } catch (error) {
        this.logger.warn(`JWT authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        // Continue to API key fallback
      }
    }

    // Fallback to API key authentication
    const apiKey = request.headers['x-api-key'] as string | undefined;
    if (apiKey) {
      try {
        const user = await this.validateApiKey(apiKey);
        if (user) {
          request.user = user;
          this.checkDemoPermissions(request, user);
          this.logger.debug(`User ${user.id} authenticated via API key`);
          return true;
        }
      } catch (error) {
        this.logger.warn(`API key authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }

    // No valid authentication method found
    this.logger.warn('No valid authentication provided');
    throw new UnauthorizedException('Authentication required. Provide either a Bearer token or X-API-Key header.');
  }

  private async validateJwtToken(token: string): Promise<User | null> {
    try {
      // Check cache first
      if (this.jwtCache.has(token)) {
        return this.jwtCache.get(token)!;
      }

      // Verify JWT token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      if (!payload.sub || !payload.email) {
        throw new UnauthorizedException('Invalid token payload');
      }

      // Get user from database
      const user = await this.authService.validateUserById(payload.sub);
      if (!user) {
        throw new UnauthorizedException('User not found or inactive');
      }

      // Update last seen
      await this.authService.updateLastSeen(user.id);

      // Cache the result (with a reasonable TTL - we'll clean this periodically)
      this.jwtCache.set(token, user);

      return user;
    } catch (error) {
      if (error instanceof Error && error.name === 'TokenExpiredError') {
        throw new UnauthorizedException('Token has expired');
      } else if (error instanceof Error && error.name === 'JsonWebTokenError') {
        throw new UnauthorizedException('Invalid token');
      }
      throw new UnauthorizedException('Token validation failed');
    }
  }

  private async validateApiKey(apiKey: string): Promise<User | null> {
    // Check cache first
    if (this.apiKeyCache.has(apiKey)) {
      return this.apiKeyCache.get(apiKey)!;
    }

    // If not in cache, validate against DB
    const user = await this.databaseService.validateApiKey(apiKey);
    if (!user) {
      throw new UnauthorizedException('Invalid or inactive API key');
    }

    // Add to cache
    this.apiKeyCache.set(apiKey, user);
    return user;
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

  // Clean cache periodically to prevent memory leaks
  private cleanCache() {
    if (this.jwtCache.size > 1000) {
      this.logger.log('Cleaning JWT cache');
      this.jwtCache.clear();
    }
    if (this.apiKeyCache.size > 1000) {
      this.logger.log('Cleaning API key cache');
      this.apiKeyCache.clear();
    }
  }
}