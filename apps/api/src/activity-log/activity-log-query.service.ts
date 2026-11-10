import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ActivityLogEntry,
  ActivityLogFacetCounts,
  ActivityLogHistogramBucket,
  ActivityLogStatus,
  ActivityLogType,
  PaginatedResult,
} from '@wamux/shared';
import { ActivityLogEntity } from './activity-log.entity';
import { toActivityLogEntry } from './activity-log.mapper';

export interface ActivityLogFilters {
  from?: number;
  to?: number;
  status?: ActivityLogStatus[];
  type?: ActivityLogType[];
  statusCode?: number;
  route?: string;
  instanceId?: string;
  platform?: string;
  q?: string;
}

/** Cap duro do export — evita carregar um resultado gigante em memória de uma vez. */
const MAX_EXPORT_ROWS = 10_000;

/**
 * Leitura do painel de Logs/Atividade. Sempre do Postgres — nunca reconstrói
 * a partir dos providers ao vivo (é um audit trail, não um dado de domínio).
 */
@Injectable()
export class ActivityLogQueryService {
  constructor(
    @InjectRepository(ActivityLogEntity) private readonly repo: Repository<ActivityLogEntity>,
  ) {}

  async list(
    filters: ActivityLogFilters,
    cursor?: string,
    limit = 50,
  ): Promise<PaginatedResult<ActivityLogEntry>> {
    const qb = this.baseQuery(filters);
    if (cursor) {
      qb.andWhere('a."createdAt" < :cursor', { cursor: new Date(Number(cursor)) });
    }
    qb.orderBy('a."createdAt"', 'DESC').take(limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const items = page.map(toActivityLogEntry);
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? String(last.createdAt) : undefined };
  }

  /** Contadores pra lateral — sempre calculados SEM o próprio filtro de status/type (senão o usuário nunca vê "quantos falharam" depois de já ter filtrado por um status). */
  async facets(
    filters: Omit<ActivityLogFilters, 'status' | 'type'>,
  ): Promise<ActivityLogFacetCounts> {
    const [statusRows, typeRows] = await Promise.all([
      this.baseQuery(filters)
        .select('a.status', 'key')
        .addSelect('COUNT(*)::int', 'count')
        .groupBy('a.status')
        .getRawMany<{ key: ActivityLogStatus; count: number }>(),
      this.baseQuery(filters)
        .select('a.type', 'key')
        .addSelect('COUNT(*)::int', 'count')
        .groupBy('a.type')
        .getRawMany<{ key: ActivityLogType; count: number }>(),
    ]);
    const status: Partial<Record<ActivityLogStatus, number>> = {};
    for (const r of statusRows) status[r.key] = Number(r.count);
    const type: Partial<Record<ActivityLogType, number>> = {};
    for (const r of typeRows) type[r.key] = Number(r.count);
    return { status, type };
  }

  async histogram(
    filters: ActivityLogFilters,
    bucket: 'hour' | 'day' = 'hour',
  ): Promise<ActivityLogHistogramBucket[]> {
    const qb = this.baseQuery(filters)
      .select(`date_trunc('${bucket}', a."createdAt")`, 'bucketStart')
      .addSelect('COUNT(*)::int', 'count')
      .addSelect(`COUNT(*) FILTER (WHERE a.status = 'failed')::int`, 'errorCount')
      .groupBy('1')
      .orderBy('1', 'ASC');
    const rows = await qb.getRawMany<{ bucketStart: Date; count: number; errorCount: number }>();
    return rows.map((r) => ({
      bucketStart: new Date(r.bucketStart).getTime(),
      count: Number(r.count),
      errorCount: Number(r.errorCount),
    }));
  }

  /** Resultado filtrado atual, capado — pro botão "download" do painel. */
  async exportRows(filters: ActivityLogFilters): Promise<ActivityLogEntry[]> {
    const rows = await this.baseQuery(filters)
      .orderBy('a."createdAt"', 'DESC')
      .take(MAX_EXPORT_ROWS)
      .getMany();
    return rows.map(toActivityLogEntry);
  }

  private baseQuery(filters: Partial<ActivityLogFilters>) {
    const qb = this.repo.createQueryBuilder('a');
    if (filters.from != null)
      qb.andWhere('a."createdAt" >= :from', { from: new Date(filters.from) });
    if (filters.to != null) qb.andWhere('a."createdAt" <= :to', { to: new Date(filters.to) });
    if (filters.status?.length) qb.andWhere('a.status IN (:...status)', { status: filters.status });
    if (filters.type?.length) qb.andWhere('a.type IN (:...type)', { type: filters.type });
    if (filters.statusCode != null) {
      qb.andWhere('a."statusCode" = :statusCode', { statusCode: filters.statusCode });
    }
    if (filters.route) qb.andWhere('a.route ILIKE :route', { route: `%${filters.route}%` });
    if (filters.instanceId)
      qb.andWhere('a."instanceId" = :instanceId', { instanceId: filters.instanceId });
    if (filters.platform) qb.andWhere('a.platform = :platform', { platform: filters.platform });
    if (filters.q) {
      qb.andWhere('(a.activity ILIKE :q OR a.message ILIKE :q)', { q: `%${filters.q}%` });
    }
    return qb;
  }
}
