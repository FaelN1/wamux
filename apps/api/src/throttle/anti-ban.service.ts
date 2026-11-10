import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { AntiBanConfig, ANTI_BAN_PRESETS, RiskProfile } from '@wamux/shared';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Resolve a config anti-ban efetiva de uma instância e mantém, no Redis, o
 * estado de curto prazo: quota diária (warmup) e flag de auto-throttle.
 * Camada ACIMA do provider — o mesmo cálculo vale para baileys/webjs/whatsmeow.
 */
@Injectable()
export class AntiBanService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Preset do perfil + overrides da instância (config.antiBan). */
  resolve(cfg?: Partial<AntiBanConfig> & { profile?: RiskProfile }): AntiBanConfig {
    const base = ANTI_BAN_PRESETS[cfg?.profile ?? 'conservative'];
    return {
      ...base,
      ...cfg,
      limits: { ...base.limits, ...cfg?.limits },
      warmup: { ...base.warmup, ...cfg?.warmup },
      humanize: { ...base.humanize, ...cfg?.humanize },
      autoThrottle: { ...base.autoThrottle, ...cfg?.autoThrottle },
    };
  }

  /** Teto diário de HOJE considerando a rampa de warmup (linear até `days`). */
  effectiveDailyCap(cfg: AntiBanConfig): number {
    if (!cfg.warmup.enabled || !cfg.warmupStartedAt) return cfg.limits.perDay;
    const days = (Date.now() - cfg.warmupStartedAt) / 86_400_000;
    if (days >= cfg.warmup.days) return cfg.limits.perDay;
    const t = cfg.warmup.days > 0 ? days / cfg.warmup.days : 1; // 0..1
    return Math.round(cfg.warmup.startPerDay + (cfg.limits.perDay - cfg.warmup.startPerDay) * t);
  }

  /** Params do token bucket — aplica o freio de auto-throttle quando ativo. */
  async rate(instanceId: string, cfg: AntiBanConfig): Promise<{ capacity: number; refillPerSec: number }> {
    const factor = (await this.isThrottled(instanceId)) ? cfg.autoThrottle.reduceFactor : 1;
    const perMinute = Math.max(1, Math.floor(cfg.limits.perMinute * factor));
    return {
      capacity: Math.max(1, Math.floor(cfg.limits.burst * factor)),
      refillPerSec: perMinute / 60,
    };
  }

  async isThrottled(instanceId: string): Promise<boolean> {
    return (await this.redis.exists(`ab:throttle:${instanceId}`)) === 1;
  }

  /** Consome 1 do teto diário. false quando estourou (warmup / perDay). */
  async tryConsumeDaily(instanceId: string, cap: number): Promise<{ allowed: boolean; used: number }> {
    const key = `ab:day:${instanceId}:${new Date().toISOString().slice(0, 10)}`;
    const used = await this.redis.incr(key);
    if (used === 1) await this.redis.expire(key, 26 * 60 * 60);
    if (used > cap) {
      await this.redis.decr(key); // não conta o que foi recusado
      return { allowed: false, used: used - 1 };
    }
    return { allowed: true, used };
  }

  async dailyUsed(instanceId: string): Promise<number> {
    const key = `ab:day:${instanceId}:${new Date().toISOString().slice(0, 10)}`;
    return Number((await this.redis.get(key)) ?? 0);
  }
}
