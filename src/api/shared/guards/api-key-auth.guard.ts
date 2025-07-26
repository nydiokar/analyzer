import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { DatabaseService } from '../../services/database.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../shared/decorators/public.decorator';
import { ConfigService } from '@nestjs/config';
import { User } from '@prisma/client';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);
  private readonly demoWallets: string[];
  private readonly apiKeyCache = new Map<string, User>();

  constructor(
    private readonly databaseService: DatabaseService,
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

    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing.');
    }

    // --- Check Cache First ---
    if (this.apiKeyCache.has(apiKey)) {
      const cachedUser = this.apiKeyCache.get(apiKey)!;
      request.user = cachedUser;
      // Re-run permission checks on the cached user
      this.checkDemoPermissions(request, cachedUser);
      return true;
    }

    // --- If not in cache, validate against DB ---
    try {
      const user = await this.databaseService.validateApiKey(apiKey);
      if (!user) {
        this.logger.warn(`Invalid or inactive API key provided: ${apiKey.substring(0, 5)}...`);
        throw new UnauthorizedException('Invalid or inactive API key.');
      }
      
      // Attach user to request for downstream use and add to cache
      request.user = user;
      this.apiKeyCache.set(apiKey, user);
      this.logger.debug(`User ${user.id} validated and added to cache.`);

      // --- Permission Check based on isDemo flag ---
      this.checkDemoPermissions(request, user);
      
      this.logger.debug(`User ${user.id} (isDemo: ${user.isDemo}) granted access to ${request.method} ${request.path}`);
      return true;

    } catch (error) {
      // Log the error but re-throw known exceptions to let NestJS handle the response
      if (error instanceof UnauthorizedException || error instanceof ForbiddenException) {
        throw error;
      }
      // Log unexpected errors and throw a generic server error
      this.logger.error('An unexpected error occurred during API key validation:', error);
      throw new UnauthorizedException('An error occurred during authentication.');
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
} 