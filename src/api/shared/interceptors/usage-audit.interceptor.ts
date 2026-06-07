import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
  HttpException,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { User } from '@prisma/client';
import { ApiKeyScope } from '../services/api-key.service';
import { Request } from 'express';

interface AuditedRequest extends Request {
  headers: Record<string, string | string[] | undefined>;
  user?: User;
  apiKeyInfo?: {
    id?: string;
    prefix?: string;
    description?: string;
    scopes?: ApiKeyScope[];
  };
  creditCost?: number;
  creditsPrecharged?: boolean;
  x402Paid?: boolean;
  x402PendingTxSig?: string;
}

interface AuditedResponse {
  statusCode?: number;
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.join(',');
  }

  return value ?? null;
}

function firstForwardedIp(value: string | string[] | undefined): string | null {
  const raw = headerValue(value);
  if (!raw) {
    return null;
  }

  return raw.split(',')[0]?.trim() || null;
}

function clientIp(req: AuditedRequest): string {
  return (
    headerValue(req.headers['cf-connecting-ip']) ||
    firstForwardedIp(req.headers['x-forwarded-for']) ||
    headerValue(req.headers['x-real-ip']) ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function shouldAudit(path: string): boolean {
  return (
    path.startsWith('/api/v1/intel') ||
    path.startsWith('/api/v1/jobs') ||
    path.startsWith('/intel') ||
    path.startsWith('/jobs')
  );
}

@Injectable()
export class UsageAuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(UsageAuditInterceptor.name);

  private logAudit(req: AuditedRequest, res: AuditedResponse, startedAt: number, error?: unknown): void {
    const path = req.originalUrl || req.url || '';
    const statusCode =
      error instanceof HttpException
        ? error.getStatus()
        : res.statusCode ?? null;
    const audit = {
      event: 'usage_audit',
      method: req.method ?? null,
      path,
      statusCode,
      durationMs: Date.now() - startedAt,
      userId: req.user?.id ?? null,
      userEmail: req.user?.email ?? null,
      apiKeyPrefix: req.apiKeyInfo?.prefix ?? null,
      apiKeyDescription: req.apiKeyInfo?.description ?? null,
      authMode: req.apiKeyInfo ? 'api_key' : req.x402Paid || req.x402PendingTxSig ? 'x402' : req.user ? 'user' : 'anonymous',
      creditCost: req.creditCost ?? null,
      creditsPrecharged: req.creditsPrecharged === true,
      x402Paid: req.x402Paid === true,
      clientIp: clientIp(req),
      cfConnectingIp: headerValue(req.headers['cf-connecting-ip']),
      xForwardedFor: headerValue(req.headers['x-forwarded-for']),
      remoteAddress: req.socket?.remoteAddress ?? null,
      userAgent: headerValue(req.headers['user-agent']),
      errorName: error instanceof Error ? error.name : null,
    };

    this.logger.log(JSON.stringify(audit));
  }

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuditedRequest>();
    const res = context.switchToHttp().getResponse<AuditedResponse>();
    const path = req.originalUrl || req.url || '';

    if (!shouldAudit(path)) {
      return next.handle();
    }

    const startedAt = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          this.logAudit(req, res, startedAt);
        },
        error: (error) => {
          this.logAudit(req, res, startedAt, error);
        },
      }),
    );
  }
}
