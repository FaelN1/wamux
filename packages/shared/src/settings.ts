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
