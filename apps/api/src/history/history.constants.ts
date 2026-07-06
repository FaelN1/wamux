export const HISTORY_QUEUE = 'history-import';

export interface HistoryImportJob {
  jobId: string; // = id do HistoryImportJobEntity
  instanceId: string;
  from?: number; // unix ms
  to?: number;
  chats?: string[];
  deliverToWebhook: boolean;
  /** pausa entre páginas (ms) — respeita anti-ban. */
  pageDelayMs: number;
  /** tamanho de página do on-demand sync. */
  pageSize: number;
}
