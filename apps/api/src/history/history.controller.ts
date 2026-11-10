import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction } from '@wamux/shared';
import { ID_PARAM, OK_SCHEMA } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { StartImportDto } from './dto/import-history.dto';
import { HistoryService } from './history.service';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

const HISTORY_IMPORT_STATUSES = ['queued', 'running', 'done', 'partial', 'failed', 'canceled'];

/** Param de rota `:jobId` (id do job de import). */
const JOB_ID_PARAM = { name: 'jobId', description: 'ID (uuid) do job de import.' } as const;

/** Resposta de POST /history/import (job enfileirado). */
const START_IMPORT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jobId: { type: 'string', format: 'uuid' },
    status: { type: 'string', enum: HISTORY_IMPORT_STATUSES },
  },
};

/** Estado/progresso do job de import (entidade + percent). */
const IMPORT_STATUS_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', format: 'uuid', description: '= jobId' },
    instanceId: { type: 'string' },
    status: { type: 'string', enum: HISTORY_IMPORT_STATUSES },
    from: {
      type: 'string',
      nullable: true,
      description: 'início do range (epoch ms, como string)',
    },
    to: { type: 'string', nullable: true, description: 'fim do range (epoch ms, como string)' },
    chats: {
      type: 'array',
      items: { type: 'string' },
      description: 'jids alvo (vazio = engine escolhe)',
    },
    deliverToWebhook: { type: 'boolean' },
    imported: { type: 'number', description: 'mensagens importadas' },
    duplicates: { type: 'number', description: 'mensagens ignoradas por dedup' },
    chatsProcessed: { type: 'number' },
    oldestReached: {
      type: 'string',
      nullable: true,
      description: 'timestamp (unix s) da mensagem mais antiga alcançada',
    },
    message: { type: 'string', nullable: true, description: 'detalhe do estado (ex.: erro)' },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' },
    percent: {
      type: 'number',
      nullable: true,
      description: '0..100 (null enquanto não dá pra calcular)',
    },
  },
};

@ApiTags('Histórico')
@ApiSecurity('apikey')
@Controller('instances')
@UseGuards(InstanceApiKeyGuard)
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Post(':id/history/import')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Dispara import de histórico',
    description: 'Enfileira um import por range de data/chats (assíncrono). Acompanhe pelo jobId.',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ description: 'Job enfileirado.', schema: START_IMPORT_SCHEMA })
  async start(@Param('id') id: string, @Body() dto: StartImportDto) {
    const job = await this.history.start(id, dto);
    return { jobId: job.id, status: job.status };
  }

  @Get(':id/history/import/:jobId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Progresso do import',
    description: 'Percentual, contadores e estado do job. 404 se o job não existir.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JOB_ID_PARAM)
  @ApiOkResponse({ description: 'Estado do job.', schema: IMPORT_STATUS_SCHEMA })
  status(@Param('id') id: string, @Param('jobId') jobId: string) {
    return this.history.status(id, jobId);
  }

  @Post(':id/history/import/:jobId/cancel')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Cancela o import',
    description:
      'Sinaliza o cancelamento; o worker encerra entre páginas. 404 se o job não existir.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JOB_ID_PARAM)
  @ApiOkResponse({ schema: OK_SCHEMA })
  async cancel(@Param('id') id: string, @Param('jobId') jobId: string) {
    await this.history.cancel(id, jobId);
    return { ok: true };
  }
}
