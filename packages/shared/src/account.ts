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

export interface ConversationAnalyticsQuery {
  start: number;
  end: number;
  granularity?: 'HALF_HOUR' | 'DAILY' | 'MONTHLY';
  metricTypes?: string[];
  conversationCategories?: string[];
  dimensions?: string[];
}
