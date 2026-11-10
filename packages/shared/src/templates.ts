/**
 * Templates HSM da WhatsApp Cloud API (Meta). Cloud-only — as engines não
 * oficiais (baileys/webjs/whatsmeow) ficam 501. Gated por `capabilities.templates`.
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
  allow_category_change?: boolean;
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
  | { type: 'coupon_code'; coupon_code: string };

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
}

export interface TemplateAnalyticsQuery {
  start: number;
  end: number;
  templateIds: string[];
  metricTypes?: string[];
  granularity?: 'DAILY';
}
