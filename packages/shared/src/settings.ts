import { z } from 'zod';

/**
 * Configurações globais do WAMux, editáveis pelo painel e persistidas no banco
 * (com defaults vindos do .env).
 */
export interface WamuxSettings {
  /** Rate limit de envio por instância (token bucket) — anti-ban. */
  rateLimit: { perSec: number; burst: number };
  /** Webhook padrão aplicado às instâncias sem webhook próprio. */
  webhookGlobal: { enabled: boolean; url: string };
  /** Identidade mostrada no WhatsApp em "Aparelhos conectados" (Baileys). */
  device: { client: string; browser: string };
}

export const DEFAULT_SETTINGS: WamuxSettings = {
  rateLimit: { perSec: 1, burst: 5 },
  webhookGlobal: { enabled: false, url: '' },
  device: { client: 'WAMux', browser: 'Chrome' },
};

/** `unknown` = não checado (dependência opcional ou desligada por config). */
export type ServiceStatus = 'up' | 'down' | 'unknown';

export interface SystemService {
  /** identificador estável: postgres, redis, rabbitmq, whatsmeow, ffmpeg. */
  name: string;
  status: ServiceStatus;
  /** versão/endereço quando `up`; motivo quando `down`. */
  detail?: string;
}

/**
 * Diagnóstico somente-leitura (`GET /settings/system`). Diferente de
 * `WamuxSettings`, nada aqui é editável pelo painel: são valores de ambiente
 * (.env) e estado observado dos serviços. Existe porque o painel pedia ao
 * usuário "confira se DATABASE_SAVE_DATA_CONTACTS está ligado" sem oferecer
 * lugar nenhum para conferir.
 */
export interface SystemInfo {
  version: string;
  env: string;
  workerId: string;
  services: SystemService[];
  /** flags `DATABASE_SAVE_*` — só mudam por .env + restart. */
  persistence: {
    contacts: boolean;
    newMessage: boolean;
    messageUpdate: boolean;
    storeMediaBody: boolean;
    /** 0 = sem expurgo. */
    retentionDays: number;
  };
  media: { maxSizeMb: number };
}

/** Schema de atualização (PUT /settings) — todos os campos opcionais (patch). */
export const zSettingsUpdate = z
  .object({
    rateLimit: z
      .object({
        perSec: z.number().positive().max(100),
        burst: z.number().int().positive().max(1000),
      })
      .partial()
      .optional(),
    webhookGlobal: z
      .object({
        enabled: z.boolean(),
        url: z.string().url().or(z.literal('')),
      })
      .partial()
      .optional(),
    device: z
      .object({
        client: z.string().min(1).max(40),
        browser: z.string().min(1).max(40),
      })
      .partial()
      .optional(),
  })
  .strict();

export type SettingsUpdate = z.infer<typeof zSettingsUpdate>;
