/**
 * Painel de Logs/Atividade — leitura de eventos do gateway (mensageria,
 * conexão/QR, grupos, comunidades, newsletter, requisições de API em
 * geral). Opt-in via env (`ActivityLogConfig`), escopo admin (não por
 * instância) — ver `docs/logs-painel-handoff.md`.
 */
import { ActivityLogStatus, ActivityLogType } from './enums';

/** Linha da tabela de eventos. */
export interface ActivityLogEntry {
  id: string;
  /** ausente = evento admin/global, sem instância associada. */
  instanceId?: string;
  type: ActivityLogType;
  status: ActivityLogStatus;
  /** rótulo curto: "Message Received", "POST .../groups". */
  activity: string;
  method?: string;
  /** padrão da rota (com `:id`), nunca a URL com valores. */
  route?: string;
  statusCode?: number;
  durationMs?: number;
  /** `ProviderType` da instância, quando aplicável. */
  platform?: string;
  /** `"global"` ou `"instance:<prefixo>"` — nunca a key em si. */
  apiKeyLabel?: string;
  /** preview curto (texto/erro/payload resumido). */
  message?: string;
  /** drill-down (ex.: `req.params`, detalhe do erro). */
  metadata?: Record<string, unknown>;
  /** unix (ms). */
  createdAt: number;
}

/** Contadores pros filtros da lateral (Status/Type com número ao lado). */
export interface ActivityLogFacetCounts {
  status: Partial<Record<ActivityLogStatus, number>>;
  type: Partial<Record<ActivityLogType, number>>;
}

/** Balde do histograma (barras por período no topo do painel). */
export interface ActivityLogHistogramBucket {
  /** unix (ms) — início do balde. */
  bucketStart: number;
  count: number;
  errorCount: number;
}
