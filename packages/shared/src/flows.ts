/**
 * WhatsApp Flows (formulários no chat) da Cloud API (Meta). Cloud-only — as
 * engines não oficiais ficam 501. Gated por `capabilities.flows`. MVP: Flows
 * estáticos (sem endpoint criptografado); a resposta chega via webhook
 * `nfm_reply` (normalizado como mensagem interativa na fundação/fase 0).
 */

export type FlowStatus = 'DRAFT' | 'PUBLISHED' | 'DEPRECATED' | 'BLOCKED' | 'THROTTLED';

export type FlowCategory =
  | 'SIGN_UP'
  | 'SIGN_IN'
  | 'APPOINTMENT_BOOKING'
  | 'LEAD_GENERATION'
  | 'CONTACT_US'
  | 'CUSTOMER_SUPPORT'
  | 'SURVEY'
  | 'OTHER';

export interface Flow {
  id: string;
  name: string;
  status: FlowStatus;
  categories: FlowCategory[];
  validation_errors?: unknown[];
  endpoint_uri?: string;
  preview?: { preview_url: string; expires_at: string };
}

export interface CreateFlowInput {
  name: string;
  categories: FlowCategory[];
  /** flow JSON como string opaca (o painel edita/valida). */
  flow_json?: string;
  clone_flow_id?: string;
  endpoint_uri?: string;
  publish?: boolean;
}

export interface CreateFlowResult {
  id: string;
  validation_errors: unknown[];
}

export interface SendFlowInput {
  to: string;
  /** exatamente um dos dois. */
  flowId?: string;
  flowName?: string;
  /** ≤30 chars. */
  cta: string;
  header?: string;
  body: string;
  footer?: string;
  mode?: 'published' | 'draft';
  /** ÚNICO por usuário/sessão — chave de correlação com o nfm_reply. */
  flowToken: string;
  /** default navigate. */
  action?: 'navigate' | 'data_exchange';
  /** obrigatório se action=navigate. */
  screen?: string;
  /** se presente, não pode ser vazio. */
  data?: Record<string, unknown>;
  quotedMessageId?: string;
}

export interface FlowMetricsQuery {
  metric: string;
  granularity: 'DAY' | 'HOUR' | 'LIFETIME';
  since?: string;
  until?: string;
}
