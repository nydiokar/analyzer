// IMPORTANT: Import Sentry instrumentation FIRST, before any other imports
import './instrument';

import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ForbiddenExceptionFilter } from './api/shared/forbidden-exception.filter';
import { ThrottlerExceptionFilter } from './api/shared/throttler-exception.filter';
import { Logger, LogLevel, ValidationPipe } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as dotenv from 'dotenv';
import { json } from 'express';
import { setupThrottledLogging } from './core/logging/setup-throttled-logging';
import { MetricsService } from './api/services/metrics.service';
import { METRICS_CONFIG } from './config/constants';
import { User } from '@prisma/client';

type ApiKeyAuditInfo = {
  id?: string;
  prefix?: string;
  description?: string;
  scopes?: string[];
};

type AuditedRequest = {
  method?: string;
  originalUrl?: string;
  url?: string;
  path?: string;
  ip?: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: {
    remoteAddress?: string;
  };
  user?: User;
  apiKeyInfo?: ApiKeyAuditInfo;
  creditCost?: number;
  creditsPrecharged?: boolean;
  x402Paid?: boolean;
  x402PendingTxSig?: string;
};

type AuditedResponse = {
  statusCode?: number;
  on: (event: 'finish', listener: () => void) => void;
};

dotenv.config();

function normalizeMetricsRoute(req: { route?: { path?: string }; path?: string; originalUrl?: string }): string {
  const routePath = req.route?.path;
  if (routePath) {
    return routePath.startsWith('/') ? routePath : `/${routePath}`;
  }

  const rawPath = req.path || req.originalUrl || METRICS_CONFIG.UNKNOWN_ROUTE_LABEL;
  if (rawPath === '/' || rawPath === '') {
    return rawPath || '/';
  }

  return METRICS_CONFIG.UNKNOWN_ROUTE_LABEL;
}

function getHeaderValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) {
    return value.join(',');
  }

  return value ?? null;
}

function getFirstForwardedIp(value: string | string[] | undefined): string | null {
  const raw = getHeaderValue(value);
  if (!raw) {
    return null;
  }

  return raw.split(',')[0]?.trim() || null;
}

function getAuditClientIp(req: AuditedRequest): string {
  return (
    getHeaderValue(req.headers?.['cf-connecting-ip']) ||
    getFirstForwardedIp(req.headers?.['x-forwarded-for']) ||
    getHeaderValue(req.headers?.['x-real-ip']) ||
    req.ip ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function shouldAuditUsage(path: string): boolean {
  return (
    path.startsWith('/api/v1/intel') ||
    path.startsWith('/api/v1/jobs') ||
    path.startsWith('/intel') ||
    path.startsWith('/jobs')
  );
}

async function bootstrap() {
  // Enable throttled logging globally - prevents log spam when services fail repeatedly
  setupThrottledLogging();
  // Configure logging levels based on environment
  const isDev = process.env.NODE_ENV !== 'production';
  const isQuietMode = process.env.QUIET_MODE === 'true';
  
  let logLevels: LogLevel[];
  if (isQuietMode) {
    logLevels = ['error', 'warn']; // Minimal logging
  } else if (isDev) {
    logLevels = ['error', 'warn', 'log', 'debug', 'verbose']; // Reduced verbosity for development
  } else {
    logLevels = ['error', 'warn', 'log']; // Production logging (no debug/verbose)
  }

  const app = await NestFactory.create(AppModule, {
    logger: logLevels,
  });
  const port = process.env.PORT || 3001;
  const host = process.env.BACKEND_HOST || '::'; // Default to all IPv6 interfaces, or use configured host

  // Respect x-forwarded-for/x-real-ip from nginx so rate limiting uses the real client IP.
  app.getHttpAdapter().getInstance().set('trust proxy', true);

  app.setGlobalPrefix('api/v1');

  app.use(json({ limit: '5mb' }));

  const usageAuditLogger = new Logger('UsageAudit');
  app.use((req: AuditedRequest, res: AuditedResponse, next: () => void) => {
    const requestPath = req.originalUrl || req.url || '';
    if (!shouldAuditUsage(requestPath)) {
      next();
      return;
    }

    const startedAt = Date.now();

    res.on('finish', () => {
      const audit = {
        event: 'usage_audit',
        method: req.method ?? null,
        path: requestPath,
        statusCode: res.statusCode ?? null,
        durationMs: Date.now() - startedAt,
        userId: req.user?.id ?? null,
        userEmail: req.user?.email ?? null,
        apiKeyPrefix: req.apiKeyInfo?.prefix ?? null,
        apiKeyDescription: req.apiKeyInfo?.description ?? null,
        authMode: req.apiKeyInfo ? 'api_key' : req.x402Paid || req.x402PendingTxSig ? 'x402' : req.user ? 'user' : 'anonymous',
        creditCost: req.creditCost ?? null,
        creditsPrecharged: req.creditsPrecharged === true,
        x402Paid: req.x402Paid === true,
        clientIp: getAuditClientIp(req),
        cfConnectingIp: getHeaderValue(req.headers?.['cf-connecting-ip']),
        xForwardedFor: getHeaderValue(req.headers?.['x-forwarded-for']),
        remoteAddress: req.socket?.remoteAddress ?? null,
        userAgent: getHeaderValue(req.headers?.['user-agent']),
      };

      usageAuditLogger.log(JSON.stringify(audit));
    });

    next();
  });

  // HTTP Metrics Middleware - tracks all requests
  const metricsService = app.get(MetricsService);
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();

    res.on('finish', () => {
      // Use controller route templates when available, otherwise collapse unmatched traffic.
      const route = normalizeMetricsRoute(req);

      // Increment request counter
      metricsService.httpRequestsTotal
        .labels(req.method, route, res.statusCode.toString())
        .inc();

      // Observe request duration
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      metricsService.httpRequestDuration
        .labels(req.method, route, res.statusCode.toString())
        .observe(durationSeconds);
    });

    next();
  });

  app.useWebSocketAdapter(new IoAdapter(app));

  // Secure CORS setup for production
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    // Support comma-separated URLs for multiple domains (e.g., with and without www)
    const allowedOrigins = frontendUrl.split(',').map(url => url.trim());
    app.enableCors({
      origin: allowedOrigins,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'X-CSRF-Token'],
    });
    Logger.log(`CORS enabled for origins: ${allowedOrigins.join(', ')}`, 'Bootstrap');
  } else {
    // Fallback for local development
    app.enableCors({
      origin: true, // Allow all origins in development
      credentials: true,
    });
    Logger.warn(`CORS enabled for all origins (FRONTEND_URL not set)`, 'Bootstrap');
  }

  // --- Swagger OpenAPI Documentation Setup ---
  const config = new DocumentBuilder()
    .setTitle('Wallet Analyzer API')
    .setDescription('API for tracking and analyzing Solana wallets.')
    .setVersion('1.0')
    .addTag('wallets', 'Wallet-related operations')
    .addTag('users', 'User-related operations')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document);
  // --- End Swagger Setup ---

  // Enforce DTO class-validator decorators (e.g. @ArrayMaxSize, @IsString, @IsOptional)
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: false, transform: true }));

  // Register global exception filters for user-friendly error messages
  app.useGlobalFilters(
    new ForbiddenExceptionFilter(),
    new ThrottlerExceptionFilter()
  );

  await app.listen(port, host);

  // Display appropriate URL based on configured host
  const displayHost = host === '::' ? 'localhost' : (host.includes(':') ? `[${host}]` : host);
  Logger.log(`🚀 Application is running on: http://${displayHost}:${port}/api/v1`, 'Bootstrap');
  Logger.log(`📚 API Documentation available at: http://${displayHost}:${port}/api-docs`, 'Bootstrap');
  Logger.log(`🔌 WebSocket server enabled at: ws://${displayHost}:${port}/job-progress`, 'Bootstrap');

  if (host !== '::' && host !== 'localhost' && host !== '127.0.0.1') {
    Logger.log(`🌐 Server bound to specific address: ${host}`, 'Bootstrap');
  }

  // Heartbeat logging to detect event loop blocking / system freezes
  // Logs every 30 seconds to help diagnose issues like database checkpoint hangs
  setInterval(() => {
    Logger.log('[Heartbeat] Backend responsive', 'HealthCheck');
  }, 30000); // 30 seconds
}
bootstrap();
