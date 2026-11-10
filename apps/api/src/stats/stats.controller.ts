import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { StatsService } from './stats.service';

// ── Schema de resposta (documenta "o que retorna" no OpenAPI) ──

const SENT_RECEIVED_SCHEMA: SchemaObject = {
  type: 'object',
  properties: { sent: { type: 'number' }, received: { type: 'number' } },
};

/** Métricas de mensagens (StatsMessages). */
const STATS_MESSAGES_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    total: { type: 'number' },
    sent: { type: 'number' },
    received: { type: 'number' },
    today: SENT_RECEIVED_SCHEMA,
    last7d: SENT_RECEIVED_SCHEMA,
    ack: {
      type: 'object',
      description: 'funil de ack das mensagens ENVIADAS',
      properties: {
        pending: { type: 'number' },
        server: { type: 'number' },
        delivered: { type: 'number' },
        read: { type: 'number' },
        played: { type: 'number' },
        failed: { type: 'number' },
      },
    },
    deliveryRate: { type: 'number', description: 'entregue/chegou ao servidor (0–1)' },
    readRate: { type: 'number', description: 'lida/chegou ao servidor (0–1)' },
    perDay: {
      type: 'array',
      description: 'série diária dos últimos 14 dias',
      items: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'ISO YYYY-MM-DD' },
          sent: { type: 'number' },
          received: { type: 'number' },
        },
      },
    },
  },
};

/** Métricas de webhooks (StatsWebhooks). */
const STATS_WEBHOOKS_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    delivered: { type: 'number' },
    failed: { type: 'number' },
    pending: { type: 'number' },
    dlq: { type: 'number', description: 'itens na DLQ (jobs failed)' },
    successRate: { type: 'number', description: 'delivered/(delivered+failed) (0–1)' },
  },
};

/** Resposta de GET /stats/overview (StatsOverview). */
const STATS_OVERVIEW_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    messages: STATS_MESSAGES_SCHEMA,
    webhooks: STATS_WEBHOOKS_SCHEMA,
    generatedAt: { type: 'string', format: 'date-time' },
  },
};

@ApiTags('Stats')
@ApiSecurity('apikey')
@Controller('stats')
@UseGuards(GlobalApiKeyGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Métricas agregadas: mensagens (funil de ack, série diária) e webhooks.',
    description: 'Requer a GLOBAL_API_KEY. Leitura pura para a dashboard.',
  })
  @ApiOkResponse({ schema: STATS_OVERVIEW_SCHEMA })
  overview() {
    return this.stats.overview();
  }
}
