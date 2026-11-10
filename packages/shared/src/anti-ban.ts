import { z } from 'zod';

// ── camada anti-ban ─────────────────────────────────

/** Perfil de risco de envio de uma instância. */
export type RiskProfile = 'conservative' | 'normal' | 'aggressive';

/** Tetos de envio por janela + burst do token bucket. */
export interface AntiBanLimits {
  perMinute: number;
  perDay: number;
  /** capacidade (burst) do token bucket. */
  burst: number;
}

export interface WarmupConfig {
  enabled: boolean;
  /** dias de rampa até o teto pleno do perfil. */
  days: number;
  /** teto de mensagens/dia no primeiro dia. */
  startPerDay: number;
}

export interface HumanizeConfig {
  enabled: boolean;
  /** jitter aleatório entre envios (ms). */
  minDelayMs: number;
  maxDelayMs: number;
  /** emitir "digitando…" antes de mandar texto. */
  composing: boolean;
  /** ms de "digitando" por caractere do texto. */
  msPerChar: number;
  /** teto do "digitando" (não trava textos longos). */
  maxComposingMs: number;
}

export interface AutoThrottleConfig {
  enabled: boolean;
  /** janela deslizante (s) onde os sinais de risco são contados. */
  windowSec: number;
  /** nº de sinais na janela que aciona o freio. */
  threshold: number;
  /** fator aplicado aos tetos ao frear (0.5 = corta pela metade). */
  reduceFactor: number;
  /** duração (s) do modo reduzido antes de recuperar. */
  cooldownSec: number;
}

export interface AntiBanConfig {
  profile: RiskProfile;
  limits: AntiBanLimits;
  warmup: WarmupConfig;
  humanize: HumanizeConfig;
  autoThrottle: AutoThrottleConfig;
  /** epoch (ms) do 1º connect — âncora da rampa de warmup. Setado no runtime. */
  warmupStartedAt?: number;
}

/** Presets por perfil — defaults tunáveis; conservador é o padrão. */
export const ANTI_BAN_PRESETS: Record<RiskProfile, AntiBanConfig> = {
  conservative: {
    profile: 'conservative',
    limits: { perMinute: 8, perDay: 500, burst: 3 },
    warmup: { enabled: true, days: 14, startPerDay: 40 },
    humanize: {
      enabled: true,
      minDelayMs: 1500,
      maxDelayMs: 4000,
      composing: true,
      msPerChar: 55,
      maxComposingMs: 6000,
    },
    autoThrottle: { enabled: true, windowSec: 120, threshold: 5, reduceFactor: 0.5, cooldownSec: 900 },
  },
  normal: {
    profile: 'normal',
    limits: { perMinute: 20, perDay: 2000, burst: 6 },
    warmup: { enabled: true, days: 7, startPerDay: 120 },
    humanize: {
      enabled: true,
      minDelayMs: 800,
      maxDelayMs: 2500,
      composing: true,
      msPerChar: 35,
      maxComposingMs: 4000,
    },
    autoThrottle: { enabled: true, windowSec: 120, threshold: 8, reduceFactor: 0.5, cooldownSec: 600 },
  },
  aggressive: {
    profile: 'aggressive',
    limits: { perMinute: 60, perDay: 10000, burst: 12 },
    warmup: { enabled: false, days: 0, startPerDay: 0 },
    humanize: {
      enabled: false,
      minDelayMs: 200,
      maxDelayMs: 800,
      composing: false,
      msPerChar: 0,
      maxComposingMs: 0,
    },
    autoThrottle: { enabled: true, windowSec: 120, threshold: 12, reduceFactor: 0.6, cooldownSec: 300 },
  },
};

/** Patch por instância (PUT /instances/:id/anti-ban). Só o perfil é obrigatório. */
export const zAntiBanUpdate = z
  .object({
    profile: z.enum(['conservative', 'normal', 'aggressive']),
    maxPerMinute: z.number().int().positive().max(120).optional(),
    maxPerDay: z.number().int().positive().max(50_000).optional(),
    warmup: z
      .object({
        enabled: z.boolean(),
        days: z.number().int().min(0).max(60),
        startPerDay: z.number().int().positive().max(5_000),
      })
      .partial()
      .optional(),
    humanize: z
      .object({
        enabled: z.boolean(),
        minDelayMs: z.number().int().min(0).max(30_000),
        maxDelayMs: z.number().int().min(0).max(60_000),
        composing: z.boolean(),
        msPerChar: z.number().int().min(0).max(500),
        maxComposingMs: z.number().int().min(0).max(20_000),
      })
      .partial()
      .optional(),
  })
  .strict();

export type AntiBanUpdate = z.infer<typeof zAntiBanUpdate>;
