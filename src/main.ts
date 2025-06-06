import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module'; 
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3001;
  const corsOrigin = process.env.CORS_ORIGIN;

  // For production, the CORS_ORIGIN should be set to your Vercel frontend's URL.
  // For local development, you might set it to 'http://localhost:3000'.
  // The 'true' fallback is for simple local testing but will log a warning.
  if (!corsOrigin) {
    Logger.warn('CORS_ORIGIN is not set. Allowing all origins for development purposes.', 'Bootstrap');
  }

  app.enableCors({
    origin: corsOrigin || true,
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept, X-API-Key',
    credentials: true,
  });

  // Global prefix for all API routes, as per plan (e.g., /api/v1)
  app.setGlobalPrefix('api/v1'); 

  // --- Swagger (OpenAPI) Setup --- 
  const config = new DocumentBuilder()
    .setTitle('Wallet Analysis API')
    .setDescription('API for wallet analysis services')
    .setVersion('v1')
    .addTag('Wallets') // Optional: Add tags used in controllers
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'ApiKeyAuth') // Document X-API-Key
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api-docs', app, document); // API docs will be available at /api-docs
  // --- End Swagger Setup ---

  await app.listen(port);
  Logger.log(`🚀 Application is running on: http://localhost:${port}/api/v1`, 'Bootstrap');
  Logger.log(`📚 API Documentation available at: http://localhost:${port}/api-docs`, 'Bootstrap');
}
bootstrap();

// Create a simple AppModule (e.g., in src/app.module.ts) that imports ApiModule:
/*
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ApiModule } from './api/api.module';

@Module({
  imports: [ApiModule],
})
export class AppModule {}
*/ 