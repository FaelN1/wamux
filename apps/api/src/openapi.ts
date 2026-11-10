import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { VersioningType } from '@nestjs/common';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module';
import { buildSwaggerConfig } from './swagger.config';

/**
 * Gera `openapi.json` SEM subir a porta — usado no CI e para gerar
 * SDKs. Reusa o mesmo DocumentBuilder do `main.ts` (fonte única).
 */
async function generate(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  writeFileSync('openapi.json', JSON.stringify(document, null, 2));
  await app.close();
  // eslint-disable-next-line no-console
  console.log('openapi.json gerado.');
}

void generate();
