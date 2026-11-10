/**
 * Templates HSM da WhatsApp Cloud API (Meta). Cloud-only — as engines não
 * oficiais (baileys/whatsmeow) ficam 501. Gated por `capabilities.templates`.
 */

export type TemplateCategory = 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';

export type TemplateStatus =
  | 'PENDING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED'
  | 'DISABLED'
  | 'PENDING_DELETION'
  | 'APPEAL_REQUESTED';

export type TemplateQuality = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

export type ParameterFormat = 'POSITIONAL' | 'NAMED';

export type TemplateButton =
  | { type: 'QUICK_REPLY'; text: string }
  | { type: 'URL'; text: string; url: string; example?: string[] }
  | { type: 'PHONE_NUMBER'; text: string; phone_number: string }
  | { type: 'COPY_CODE'; text?: string }
  | { type: 'OTP'; otp_type: 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP'; supported_apps?: unknown[] }
  | { type: 'FLOW'; text: string; flow_id?: string };

export type TemplateComponent =
  | {
      type: 'HEADER';
      format: 'TEXT' | 'IMAGE' | 'VIDEO' | 'DOCUMENT' | 'LOCATION';
      text?: string;
      example?: unknown;
    }
  | { type: 'BODY'; text: string; example?: unknown; add_security_recommendation?: boolean }
  | { type: 'FOOTER'; text?: string; code_expiration_minutes?: number }
  | { type: 'BUTTONS'; buttons: TemplateButton[] };

export interface MessageTemplate {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory;
  status: TemplateStatus;
  quality_score?: TemplateQuality;
  components: TemplateComponent[];
  parameter_format?: ParameterFormat;
}

export interface CreateTemplateInput {
  name: string;
  language: string;
  category: TemplateCategory;
  components: TemplateComponent[];
  parameter_format?: ParameterFormat;
}

export interface CreateTemplateResult {
  id: string;
  status: TemplateStatus;
  category: TemplateCategory;
}

export interface EditTemplatePatch {
  category?: TemplateCategory;
  components?: TemplateComponent[];
}

export interface DeleteTemplateInput {
  name: string;
  /** para apagar só UM locale; sem ele, apaga todas as línguas do nome. */
  hsmId?: string;
}

export interface TemplateFilter {
  category?: TemplateCategory;
  status?: TemplateStatus;
  language?: string;
  name?: string;
}

// ── envio (preenchimento dos parâmetros) ──────────────────

export type TemplateParam =
  | { type: 'text'; text: string; parameter_name?: string }
  | { type: 'image'; image: { link?: string; id?: string } }
  | { type: 'video'; video: { link?: string; id?: string } }
  | { type: 'document'; document: { link?: string; id?: string; filename?: string } }
  | { type: 'currency'; currency: { fallback_value: string; code: string; amount_1000: number } }
  | { type: 'date_time'; date_time: { fallback_value: string } }
  | { type: 'payload'; payload: string }
  | { type: 'coupon_code'; coupon_code: string }
  /** botão FLOW: token de correlação e dados iniciais da primeira tela. */
  | {
      type: 'action';
      action: { flow_token?: string; flow_action_data?: Record<string, unknown> };
    };

export type TemplateSendComponent =
  | { type: 'body'; parameters: TemplateParam[] }
  | { type: 'header'; parameters: TemplateParam[] }
  | {
      type: 'button';
      sub_type: 'quick_reply' | 'url' | 'copy_code' | 'flow';
      index: string;
      parameters: TemplateParam[];
    };

export interface SendTemplateInput {
  to: string;
  name: string;
  /** código da língua, ex.: pt_BR. */
  language: string;
  components?: TemplateSendComponent[];
  quotedMessageId?: string;
  /**
   * Por onde enviar. `cloud` (default) = `/messages`. `marketing` = Marketing
   * Messages API (`/marketing_messages`) — só templates da categoria MARKETING,
   * com otimização de entrega da Meta. A Meta desliga marketing em `/messages`
   * em 2027-10-13 (contas novas: 2027-04-13).
   */
  route?: TemplateSendRoute;
  /**
   * Só com `route: marketing`. `CLOUD_API_FALLBACK` (default da Meta): se a
   * conta não concluiu o onboarding da MM API, a Meta entrega pela Cloud API.
   * `STRICT`: sem fallback — falha em vez de cair na Cloud.
   */
  productPolicy?: MarketingProductPolicy;
  /** Só com `route: marketing`: compartilhar atividade da mensagem com a Meta (omitido = configuração da conta). */
  messageActivitySharing?: boolean;
}

export type TemplateSendRoute = 'cloud' | 'marketing';
export type MarketingProductPolicy = 'CLOUD_API_FALLBACK' | 'STRICT';

export interface TemplateAnalyticsQuery {
  start: number;
  end: number;
  templateIds: string[];
  metricTypes?: string[];
  granularity?: 'DAILY';
}
