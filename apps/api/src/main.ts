import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { setupSwagger } from './swagger.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Logger estruturado (pino) como logger global.
  app.useLogger(app.get(Logger));

  // Fail-fast headless: produção com credencial default não sobe.
  // Continua 100% sem interação — só recusa o pé-na-jaca.
  const config = app.get(ConfigService);
  if (config.get('env') === 'production' && config.get('globalApiKey') === 'change-me') {
    throw new Error(
      'GLOBAL_API_KEY não configurada — defina-a no .env antes de subir em produção.',
    );
  }

  app.setGlobalPrefix('api');
  // Versionamento por URI: rotas servem em /api/v1/*; health e
  // webhooks de entrada são VERSION_NEUTRAL (URLs fixas chamadas por terceiros).
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.enableCors();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());

  // OpenAPI/Swagger: UI em /api/docs, spec em /api/docs-json.
  setupSwagger(app);

  // Encerramento gracioso: providers desconectam limpo e liberam o registry.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  app.get(Logger).log(`🚀 WAMux rodando em http://localhost:${port}/api/v1 · docs em /api/docs`);
}

void bootstrap();
