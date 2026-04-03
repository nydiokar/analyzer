import 'reflect-metadata';

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IntelOpenApiModule } from '../src/api/modules/intel-openapi.module';

const ROOT = process.cwd();
const OUTPUT_PATH = resolve(ROOT, 'artifacts/intel-openapi.json');

async function main(): Promise<void> {
  process.on('unhandledRejection', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Connection is closed') || message.includes('ECONNREFUSED')) {
      return;
    }
    console.error(error);
    process.exitCode = 1;
  });

  const app = await NestFactory.create(IntelOpenApiModule, { logger: false });
  app.setGlobalPrefix('api/v1');

  const config = new DocumentBuilder()
    .setTitle('Sova Intel Public API')
    .setDescription('Intel-only public API contract')
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'x-api-key', in: 'header' }, 'x-api-key')
    .build();

  const document = SwaggerModule.createDocument(app, config, {
    include: [IntelOpenApiModule],
    deepScanRoutes: true,
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(document, null, 2), 'utf8');

  console.log(`Wrote Intel OpenAPI artifact to ${OUTPUT_PATH}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
