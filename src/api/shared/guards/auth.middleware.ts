import { Injectable, NestMiddleware, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { DatabaseService } from '../../services/database.service';
import { getErrorMessage, getErrorDetails } from '../../../core/utils/error-utils';


@Injectable()
export class AuthMiddleware implements NestMiddleware {
  constructor(private readonly databaseService: DatabaseService) {}

  async use(req: Request & { user?: any }, res: Response, next: NextFunction) {
    const apiKey = req.headers['x-api-key'] as string;

    if (!apiKey) {
      throw new UnauthorizedException('API key is missing.');
    }

    try {
      const user = await this.databaseService.validateApiKey(apiKey);
      if (user) {
        req.user = user; // Attach user to request object
        next();
      } else {
        // If validateApiKey returns null, it means key is invalid or user is inactive
        throw new ForbiddenException('Invalid API key or inactive user.');
      }
    } catch (error) {
      // Log the error server-side if needed
      // logger.error('Auth Middleware Error:', getErrorMessage(error));
      if (error instanceof ForbiddenException || error instanceof UnauthorizedException) {
        throw error;
      }
      // Generic error for unexpected issues during validation
      throw new ForbiddenException('Invalid API key or authentication failed.');
    }
  }
} 