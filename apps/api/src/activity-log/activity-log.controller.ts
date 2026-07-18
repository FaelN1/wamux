import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ActivityLogEntry } from '@wamux/shared';
import { Response } from 'express';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { ActivityLogQueryService, ActivityLogFilters } from './activity-log-query.service';
import { ListActivityLogsQueryDto } from './dto/list-activity-logs.query.dto';

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
  list(@Query() q: ListActivityLogsQueryDto) {
    return this.query.list(filtersOf(q), q.cursor, q.limit);
  }

  @Get('facets')
  @ApiOperation({ summary: 'Contadores por status/type pros filtros da lateral.' })
  facets(@Query() q: ListActivityLogsQueryDto) {
    // status/type NUNCA entram aqui — senão o usuário perde a visão da
    // distribuição total assim que seleciona um dos dois (ver
    // ActivityLogQueryService.facets).
    const { status: _status, type: _type, ...rest } = filtersOf(q);
    return this.query.facets(rest);
  }

  @Get('histogram')
  @ApiOperation({ summary: 'Série de eventos por período (barras do topo do painel).' })
  histogram(@Query() q: ListActivityLogsQueryDto) {
    return this.query.histogram(filtersOf(q), q.bucket ?? 'hour');
  }

  @Get('export')
  @ApiOperation({
    summary: `Exporta o resultado filtrado atual em CSV (capado nas primeiras linhas — sem paginação, é um snapshot pontual).`,
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
