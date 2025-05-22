import { Injectable, CanActivate, ExecutionContext, UnauthorizedException, Logger } from '@nestjs/common';
import { Observable } from 'rxjs';
import { Request } from 'express';
import { DatabaseService } from '../database/database.service'; // Path to your NestJS DatabaseService wrapper

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyAuthGuard.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async canActivate(
    context: ExecutionContext,
  ): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: any }>();
    const apiKey = request.headers['x-api-key'] as string | undefined;

    if (!apiKey) {
      this.logger.warn('Attempted access without API key.');
      throw new UnauthorizedException('API key is missing.');
    }

    try {
      const user = await this.databaseService.validateApiKey(apiKey);

      if (!user) {
        this.logger.warn(`Attempted access with invalid or inactive API key: ${apiKey.substring(0, 8)}...`); // Log a redacted key
        throw new UnauthorizedException('Invalid or inactive API key.');
      }

      request.user = user; // Attach user to request object for use in controllers
      this.logger.verbose(`User ${user.id} authenticated successfully via API key.`);
      return true;
    } catch (error) {
      // Catch potential errors from validateApiKey, though it's designed to return null on logical failures
      this.logger.error('Error during API key validation process', error);
      throw new UnauthorizedException('Error during API key validation.');
    }
  }
} 