import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, ForbiddenException, Logger } from '@nestjs/common';
import { Request } from 'express';
import { DatabaseService } from '../database/database.service';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly reflector: Reflector,
  ) {}

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

    // --- Unified Key Logic ---
    try {
      const user = await this.databaseService.validateApiKey(apiKey);
      if (!user) {
        this.logger.warn(`Invalid or inactive API key provided: ${apiKey.substring(0, 5)}...`);
        throw new UnauthorizedException('Invalid or inactive API key.');
      }
      
      // Attach user to request for downstream use
      request.user = user;
      this.logger.verbose(`API key validated for user ${user.id}. Checking permissions...`);

      // --- Permission Check based on isDemo flag ---
      if (user.isDemo) {
        this.logger.debug(`User ${user.id} is a demo user. Applying restrictions.`);

        const isFavoritesRoute = request.path.includes('/users/me/favorites');

        // RULE 1: Demo users can manage favorites.
        if (isFavoritesRoute && (request.method === 'POST' || request.method === 'DELETE')) {
            this.logger.verbose(`Demo user ${user.id} allowed favorite management action: ${request.method}`);
        } 
        // RULE 2: For all other routes, block write actions.
        else if (request.method !== 'GET') {
          this.logger.warn(`Demo user ${user.id} blocked from performing a ${request.method} action on path: ${request.path}`);
          throw new ForbiddenException('The demo account is read-only and cannot perform this action.');
        }
      }

      this.logger.verbose(`User ${user.id} (isDemo: ${user.isDemo}) granted access to ${request.method} ${request.path}`);
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
} 