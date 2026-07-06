import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

/**
 * Config única do OpenAPI — usada pelo bootstrap (`main.ts`) e pelo
 * gerador offline (`openapi.ts`), para a spec publicada ser idêntica à servida.
 */
export function buildSwaggerConfig(): Omit<OpenAPIObject, 'paths'> {
  return new DocumentBuilder()
    .setTitle('WAMux API')
    .setDescription(
      'WhatsApp multiplexer — uma API REST, várias engines (baileys, webjs, cloud, whatsmeow). ' +
        'Self-hosted, sem licença, sem telemetria obrigatória. ' +
        'Autenticação: header `apikey` com a GLOBAL_API_KEY (admin) ou a apiKey da instância.',
    )
    .setVersion('1')
    // Botão "Authorize": a mesma chave vale como global (admin) ou de instância.
    .addApiKey({ type: 'apiKey', name: 'apikey', in: 'header' }, 'apikey')
    .build();
}

/** Monta a UI em /api/docs e a spec crua em /api/docs-json. */
export function setupSwagger(app: INestApplication): OpenAPIObject {
  const document = SwaggerModule.createDocument(app, buildSwaggerConfig());
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
    swaggerOptions: { persistAuthorization: true },
  });
  return document;
}
