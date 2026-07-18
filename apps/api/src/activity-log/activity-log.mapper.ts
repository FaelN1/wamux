import { ActivityLogEntry } from '@wamux/shared';
import { ActivityLogEntity } from './activity-log.entity';

/** `ActivityLogEntity` (linha do Postgres) → `ActivityLogEntry` (contrato de leitura). */
export function toActivityLogEntry(row: ActivityLogEntity): ActivityLogEntry {
  return {
    id: row.id,
    instanceId: row.instanceId ?? undefined,
    type: row.type,
    status: row.status,
    activity: row.activity,
    method: row.method ?? undefined,
    route: row.route ?? undefined,
    statusCode: row.statusCode ?? undefined,
    durationMs: row.durationMs ?? undefined,
    platform: row.platform ?? undefined,
    apiKeyLabel: row.apiKeyLabel ?? undefined,
    message: row.message ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: row.createdAt.getTime(),
  };
}
