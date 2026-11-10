/**
 * WhatsApp Flows (formulários no chat) da Cloud API (Meta). A GESTÃO (criar,
 * publicar, enviar, endpoint criptografado) é Cloud-only — as engines não
 * oficiais ficam 501, gated por `capabilities.flows`. A RESPOSTA de um Flow
 * (`nfm_reply`) é normalizada em `NormalizedMessage.flowResponse` e no evento
 * `flow.response` em qualquer engine que a receba.
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
  /** versão do Flow JSON em uso (ex.: "7.2") — independe da versão da Graph API. */
  json_version?: string;
  /** versão da Data API do endpoint (ex.: "3.0"); ausente em Flows sem endpoint. */
  data_api_version?: string;
  /** diagnóstico da Meta: o Flow pode ser enviado? o que o impede? */
  health_status?: unknown;
  whatsapp_business_account?: unknown;
  application?: unknown;
}

/** Metadados editáveis de um Flow (o Flow JSON é atualizado à parte, via asset). */
export interface UpdateFlowMetadataInput {
  name?: string;
  categories?: FlowCategory[];
  endpoint_uri?: string;
  application_id?: string;
}

/** Asset de um Flow (hoje só `FLOW_JSON`); `download_url` é temporária. */
export interface FlowAsset {
  name: string;
  asset_type: string;
  download_url?: string;
}

/** Estado da chave pública de criptografia registrada na Meta para o número. */
export interface FlowEncryptionInfo {
  business_public_key?: string;
  /** VALID | MISMATCH (a Meta rebaixa quando o endpoint devolve 421). */
  business_public_key_signature_status?: string;
  /** o gateway tem a chave PRIVADA correspondente guardada? */
  hasPrivateKey: boolean;
}

/** Entrada de `PUT flows/encryption`: gerar um par novo ou importar a privada. */
export interface SetFlowEncryptionInput {
  /** PEM da chave privada RSA (≥2048). Omitido = o gateway gera um par novo. */
  privateKey?: string;
  passphrase?: string;
}

/** Resposta de um Flow concluído (`nfm_reply`), normalizada. */
export interface FlowResponse {
  /** token de correlação devolvido pelo Flow (o mesmo do envio). */
  flowToken?: string;
  /** nome da resposta nativa (ex.: "flow"). */
  name?: string;
  /** texto exibido no chat (ex.: "Sent"). */
  body?: string;
  /** `response_json` já parseado (inclui o próprio flow_token). */
  data: Record<string, unknown>;
}

export type FlowSessionStatus = 'sent' | 'in_progress' | 'completed' | 'failed';

/**
 * Execução de um Flow: correlaciona instância, contato, mensagem enviada, Flow
 * e resposta pelo `flowToken`.
 */
export interface FlowSession {
  id: string;
  instanceId: string;
  flowToken: string;
  flowId?: string | null;
  flowName?: string | null;
  /** destinatário (dígitos). */
  contact?: string | null;
  /** id da mensagem que abriu o Flow. */
  messageId?: string | null;
  mode?: string | null;
  status: FlowSessionStatus;
  /** última tela/ação vista no endpoint de troca de dados. */
  lastScreen?: string | null;
  lastAction?: string | null;
  /** nº de chamadas ao endpoint nesta execução. */
  exchanges: number;
  /** resposta final (sujeita a FLOWS_SAVE_RESPONSE_DATA). */
  response?: Record<string, unknown> | null;
  /** id da mensagem `nfm_reply` que concluiu o Flow. */
  responseMessageId?: string | null;
  /** último erro reportado pelo cliente WhatsApp ou pelo endpoint. */
  error?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
}

/** Requisição decifrada da Data API repassada ao endpoint do integrador. */
export interface FlowDataExchangeRequest {
  instanceId: string;
  version?: string;
  /** INIT | BACK | data_exchange (ping e notificações de erro o gateway responde sozinho). */
  action: string;
  screen?: string;
  data?: Record<string, unknown>;
  flowToken?: string;
  /** JWT (HS256, app secret) do flow_token — só Flow JSON ≥7.3 com Data API ≥4.0. */
  flowTokenSignature?: string;
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
  /** ÚNICO por usuário/sessão — chave de correlação com o nfm_reply. Omitido = o gateway gera um. */
  flowToken?: string;
  /** default navigate. */
  action?: 'navigate' | 'data_exchange';
  /** obrigatório se action=navigate. */
  screen?: string;
  /** se presente, não pode ser vazio. */
  data?: Record<string, unknown>;
  quotedMessageId?: string;
}
