import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { ForbiddenExceptionFilter } from './api/common/filters/forbidden-exception.filter';
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import * as dotenv from 'dotenv';
import { json } from 'express';

dotenv.config();

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3001;

  app.setGlobalPrefix('api/v1');

  app.use(json({ limit: '5mb' }));

  // Secure CORS setup for production
  const frontendUrl = process.env.FRONTEND_URL;
  if (frontendUrl) {
    app.enableCors({
      origin: frontendUrl,
      methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
      credentials: true,
    });
    Logger.log(`CORS enabled for origin: ${frontendUrl}`, 'Bootstrap');
  } else {
    // Fallback for local development
    app.enableCors();
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
}
bootstrap();