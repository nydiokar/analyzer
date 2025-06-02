import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module'; 
import { Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT || 3001;

  app.enableCors({
    origin: true, // Allows all origins, good for development. For production, specify your frontend URL.
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