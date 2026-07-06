/**
 * Métricas agregadas para a dashboard (`GET /stats/overview`).
 * Mensagens vêm de `message_logs`; webhooks, da fila BullMQ (`getJobCounts`).
 */

export interface StatsMessages {
  total: number;
  sent: number;
  received: number;
  today: { sent: number; received: number };
  last7d: { sent: number; received: number };
  /** funil de ack das mensagens ENVIADAS. */
  ack: {
    pending: number;
    server: number;
    delivered: number;
    read: number;
    played: number;
    failed: number;
  };
  /** (entregue+lida+tocada) / (as que chegaram ao servidor). 0–1. */
  deliveryRate: number;
  /** (lida+tocada) / (as que chegaram ao servidor). 0–1. */
  readRate: number;
  /** série diária dos últimos 14 dias (data ISO YYYY-MM-DD). */
  perDay: { date: string; sent: number; received: number }[];
}

export interface StatsWebhooks {
  delivered: number;
  failed: number;
  pending: number;
  /** itens na DLQ (jobs `failed`). */
  dlq: number;
  /** delivered / (delivered+failed). 0–1. */
  successRate: number;
}

export interface StatsOverview {
  messages: StatsMessages;
  webhooks: StatsWebhooks;
  generatedAt: string;
}
