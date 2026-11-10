import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ActivityLogEntry, ActivityLogStatus, ActivityLogType } from '@wamux/shared';
import { Response } from 'express';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { ActivityLogQueryService, ActivityLogFilters } from './activity-log-query.service';
import { ListActivityLogsQueryDto } from './dto/list-activity-logs.query.dto';

// ── Schemas de resposta (documentam "o que retorna" no OpenAPI) ──

/** Linha da tabela de eventos (ActivityLogEntry). */
const ACTIVITY_LOG_ENTRY_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    instanceId: {
      type: 'string',
      nullable: true,
      description: 'ausente = evento admin/global, sem instância associada',
    },
    type: { type: 'string', enum: Object.values(ActivityLogType) },
    status: { type: 'string', enum: Object.values(ActivityLogStatus) },
    activity: {
      type: 'string',
      description: 'rótulo curto do evento',
      example: 'POST /instances/:id/groups',
    },
    method: { type: 'string' },
    route: { type: 'string', description: 'padrão da rota (com :id), nunca a URL com valores' },
    statusCode: { type: 'number' },
    durationMs: { type: 'number' },
    platform: { type: 'string', description: 'ProviderType da instância, quando aplicável' },
    apiKeyLabel: { type: 'string', description: '"global" ou "instance:<prefixo>"' },
    message: { type: 'string', description: 'preview curto (texto/erro/payload resumido)' },
    metadata: { type: 'object', additionalProperties: true, description: 'drill-down' },
    createdAt: { type: 'number', description: 'unix (ms)' },
  },
};

/** Página cursor-based (PaginatedResult<ActivityLogEntry>). */
const PAGINATED_LOGS_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    items: { type: 'array', items: ACTIVITY_LOG_ENTRY_SCHEMA },
    nextCursor: {
      type: 'string',
      nullable: true,
      description: 'cursor da próxima página; ausente = fim',
    },
  },
};

/** Contadores das facetas (ActivityLogFacetCounts). */
const FACET_COUNTS_SCHEMA: SchemaObject = {
  type: 'object',
  description: 'Contagem por status e por type (calculada sem os próprios filtros status/type).',
  properties: {
    status: {
      type: 'object',
      additionalProperties: { type: 'number' },
      description: 'contagem por ActivityLogStatus',
    },
    type: {
      type: 'object',
      additionalProperties: { type: 'number' },
      description: 'contagem por ActivityLogType',
    },
  },
};

/** Baldes do histograma (ActivityLogHistogramBucket[]). */
const HISTOGRAM_SCHEMA: SchemaObject = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      bucketStart: { type: 'number', description: 'unix (ms) — início do balde' },
      count: { type: 'number' },
      errorCount: { type: 'number', description: 'quantos do balde falharam' },
    },
  },
};

/**
 * Leitura do painel de Logs/Atividade. Escopo ADMIN (não por instância) —
 * `instanceId` é uma faceta/filtro, não um pré-requisito de acesso. Ver
 * `docs/logs-painel-handoff.md` §7/§11.2.
 */
@ApiTags('Activity Log')
@ApiSecurity('apikey')
@Controller('activity-logs')
@UseGuards(GlobalApiKeyGuard)
export class ActivityLogController {
  constructor(private readonly query: ActivityLogQueryService) {}

  @Get()
  @ApiOperation({
    summary: 'Eventos do painel de Logs, paginados por cursor, mais recentes primeiro.',
  })
  @ApiOkResponse({ schema: PAGINATED_LOGS_SCHEMA })
  list(@Query() q: ListActivityLogsQueryDto) {
    return this.query.list(filtersOf(q), q.cursor, q.limit);
  }

  @Get('facets')
  @ApiOperation({ summary: 'Contadores por status/type pros filtros da lateral.' })
  @ApiOkResponse({ schema: FACET_COUNTS_SCHEMA })
  facets(@Query() q: ListActivityLogsQueryDto) {
    // status/type NUNCA entram aqui — senão o usuário perde a visão da
    // distribuição total assim que seleciona um dos dois (ver
    // ActivityLogQueryService.facets).
    const { status: _status, type: _type, ...rest } = filtersOf(q);
    return this.query.facets(rest);
  }

  @Get('histogram')
  @ApiOperation({ summary: 'Série de eventos por período (barras do topo do painel).' })
  @ApiOkResponse({ schema: HISTOGRAM_SCHEMA })
  histogram(@Query() q: ListActivityLogsQueryDto) {
    return this.query.histogram(filtersOf(q), q.bucket ?? 'hour');
  }

  @Get('export')
  @ApiOperation({
    summary: `Exporta o resultado filtrado atual em CSV (capado nas primeiras linhas — sem paginação, é um snapshot pontual).`,
  })
  @ApiOkResponse({
    description: 'Arquivo CSV (attachment) com o resultado filtrado.',
    content: { 'text/csv': { schema: { type: 'string', format: 'binary' } } },
  })
  async export(@Query() q: ListActivityLogsQueryDto, @Res() res: Response) {
    const rows = await this.query.exportRows(filtersOf(q));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="activity-logs.csv"');
    res.send(toCsv(rows));
  }
}

function filtersOf(q: ListActivityLogsQueryDto): ActivityLogFilters {
  return {
    from: q.from,
    to: q.to,
    status: q.status,
    type: q.type,
    statusCode: q.statusCode,
    route: q.route,
    instanceId: q.instanceId,
    platform: q.platform,
    q: q.q,
  };
}

const CSV_COLUMNS = [
  'createdAt',
  'type',
  'status',
  'activity',
  'method',
  'route',
  'statusCode',
  'durationMs',
  'platform',
  'instanceId',
  'apiKeyLabel',
  'message',
] as const;

function csvCell(value: unknown): string {
  if (value == null) return '';
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: ActivityLogEntry[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = rows.map((r) =>
    CSV_COLUMNS.map((col) =>
      csvCell(col === 'createdAt' ? new Date(r.createdAt).toISOString() : r[col]),
    ).join(','),
  );
  return [header, ...lines].join('\n');
}
