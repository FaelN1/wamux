import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { createActivityLogMiddleware } from './common/middleware/activity-log.middleware';
import { ActivityLogService } from './activity-log/activity-log.service';
import { setupSwagger } from './swagger.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

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

  // BUG REAL achado em QA: o limite default do body-parser do Express
  // (100kb) rejeitava (`PayloadTooLargeError`, mascarado como 500 genérico
  // pelo exception filter) QUALQUER envio de mídia via `base64` acima de
  // ~75KB brutos — ou seja, praticamente toda foto/vídeo/áudio real,
  // mesmo já estando dentro do limite que o próprio `media.maxSizeMb`
  // declara suportar (usado hoje só pro download INBOUND). Alinha o limite
  // do body JSON/urlencoded ao mesmo `MEDIA_MAX_SIZE_MB`, com folga pro
  // overhead do base64 (~33%).
  const mediaMaxMb = config.get<number>('media.maxSizeMb') ?? 100;
  const bodyLimit = `${Math.ceil(mediaMaxMb * 1.4)}mb`;
  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));

  // Painel de Logs/Atividade — middleware Express puro (não interceptor Nest:
  // precisa rodar ANTES dos guards, senão apikey inválida/instância
  // inexistente nunca apareceria no audit trail). Ver activity-log.middleware.ts.
  app.use(createActivityLogMiddleware(app.get(ActivityLogService), config));

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
