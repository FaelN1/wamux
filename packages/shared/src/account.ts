/**
 * Gestão de conta/WABA e perfil de negócio da WhatsApp Cloud API (Meta).
 * Cloud-only — as engines não oficiais ficam 501. Leituras/escritas de conta
 * são gated por `capabilities.cloudAccount`; o update de perfil por `profile`.
 */

export type BusinessVertical =
  | 'OTHER'
  | 'AUTO'
  | 'BEAUTY'
  | 'APPAREL'
  | 'EDU'
  | 'ENTERTAIN'
  | 'EVENT_PLAN'
  | 'FINANCE'
  | 'GROCERY'
  | 'GOVT'
  | 'HOTEL'
  | 'HEALTH'
  | 'NONPROFIT'
  | 'PROF_SERVICES'
  | 'RETAIL'
  | 'TRAVEL'
  | 'RESTAURANT'
  | 'ALCOHOL'
  | 'ONLINE_GAMBLING'
  | 'PHYSICAL_GAMBLING'
  | 'OTC_DRUGS';

/** Campos do perfil de negócio a atualizar (só os presentes são enviados). */
export interface UpdateProfileInput {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  vertical?: BusinessVertical;
  /** máx 2. */
  websites?: string[];
  /** handle da Resumable Upload API (não o /media). */
  profilePictureHandle?: string;
}

export interface PhoneNumberInfo {
  id: string;
  verified_name?: string;
  display_phone_number?: string;
  quality_rating?: string;
  code_verification_status?: string;
  name_status?: string;
  messaging_limit_tier?: string;
  throughput?: unknown;
  platform_type?: string;
  /** diagnóstico da Meta: o número pode enviar? o que o limita? */
  health_status?: unknown;
  /** override de webhook configurado para este número. */
  webhook_configuration?: unknown;
}

export interface RequestCodeInput {
  codeMethod: 'SMS' | 'VOICE';
  language: string;
}

export interface RegisterNumberInput {
  pin: string;
  dataLocalizationRegion?: string;
}

export interface MessagingAnalyticsQuery {
  start: number;
  end: number;
  granularity?: 'HALF_HOUR' | 'DAY' | 'MONTH';
  phoneNumbers?: string[];
  productTypes?: number[];
  countryCodes?: string[];
}

/**
 * `pricing_analytics` — custo/volume por mensagem. Substitui o antigo
 * `conversation_analytics`, desligado pela Meta em 2026-11-01.
 */
export interface PricingAnalyticsQuery {
  start: number;
  end: number;
  granularity?: 'HALF_HOUR' | 'DAILY' | 'MONTHLY';
  phoneNumbers?: string[];
  countryCodes?: string[];
  /** COST | VOLUME */
  metricTypes?: string[];
  /** REGULAR | FREE_CUSTOMER_SERVICE | FREE_ENTRY_POINT */
  pricingTypes?: string[];
  /** MARKETING | UTILITY | AUTHENTICATION | SERVICE … */
  pricingCategories?: string[];
  /** COUNTRY | PHONE | PRICING_CATEGORY | PRICING_TYPE | TIER */
  dimensions?: string[];
}
