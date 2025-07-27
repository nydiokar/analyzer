import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ForbiddenExceptionFilter } from './api/shared/forbidden-exception.filter';
import { Logger, LogLevel } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import * as dotenv from 'dotenv';
import { json } from 'express';

dotenv.config();

async function bootstrap() {
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

  app.setGlobalPrefix('api/v1');

  app.use(json({ limit: '5mb' }));

  app.useWebSocketAdapter(new IoAdapter(app));

  // Secure CORS setup for production
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    app.enableCors({
      origin: [frontendUrl], // Allow both configured and Vercel
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    });
    Logger.log(`CORS enabled for origins: ${frontendUrl}`, 'Bootstrap');
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

  app.useGlobalFilters(new ForbiddenExceptionFilter());

  await app.listen(port, '::');
  Logger.log(`🚀 Application is running on: http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`📚 API Documentation available at: http://localhost:${port}/api-docs`, 'Bootstrap');
  Logger.log(`🔌 WebSocket server enabled at: ws://localhost:${port}/job-progress`, 'Bootstrap');
}
bootstrap();