import { ExceptionFilter, Catch, ArgumentsHost, Logger } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';

/**
 * Custom exception filter for rate limiting errors
 * Provides user-friendly messages instead of technical jargon
 */
@Catch(ThrottlerException)
export class ThrottlerExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ThrottlerExceptionFilter.name);

  catch(exception: ThrottlerException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = 429; // Too Many Requests

    // Map routes to user-friendly messages
    const userFriendlyMessages: Record<string, string> = {
      '/auth/reset-password': 'Whoa, slow down! You\'re trying this too fast. Take a minute and try again.',
      '/auth/forgot-password': 'Too many password reset requests. Please wait a few minutes before trying again.',
      '/auth/login': 'Too many login attempts. Take a breather and try again in a minute.',
      '/auth/register': 'Too many registration attempts. Please wait a moment before trying again.',
      '/auth/verify-email': 'Too many verification attempts. Please wait a few minutes.',
    };

    // Get user-friendly message or use a generic one
    const path = request.url.split('?')[0]; // Remove query params
    const message = userFriendlyMessages[path] ||
      'You\'re going a bit too fast! Please wait a moment before trying again.';

    this.logger.warn(`Rate limit exceeded on ${request.method} ${request.url} from ${request.ip}`);

    response
      .status(status)
      .json({
        statusCode: status,
        message: message,
        error: 'Too Many Requests',
      });
  }
}
