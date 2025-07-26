import { ExceptionFilter, Catch, ArgumentsHost, HttpException, ForbiddenException, Logger } from '@nestjs/common';
import { Request, Response } from 'express';

@Catch(ForbiddenException)
export class ForbiddenExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ForbiddenExceptionFilter.name);

  catch(exception: ForbiddenException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const status = exception.getStatus();

    const message = exception.message || 'Access Forbidden';

    this.logger.warn(`Forbidden Access on ${request.method} ${request.url}: "${message}"`);

    response
      .status(status)
      .json({
        statusCode: status,
        message: message,
        path: request.url,
      });
  }
} 