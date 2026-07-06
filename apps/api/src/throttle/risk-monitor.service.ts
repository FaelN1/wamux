import { Inject, Injectable, Logger } from '@nestjs/common';
import Redis from 'ioredis';
import { AntiBanConfig } from '@wamux/shared';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Janela deslizante de sinais de risco → auto-throttle. Cada sinal
 * (erro, desconexão inesperada, falha de envio) entra num sorted-set; ao cruzar
 * o limiar, arma o freio (flag com TTL = cooldown).
 */
@Injectable()
export class RiskMonitorService {
  private readonly logger = new Logger(RiskMonitorService.name);
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async record(
    instanceId: string,
    cfg: AntiBanConfig,
    reason: string,
  ): Promise<{ tripped: boolean; count: number }> {
    if (!cfg.autoThrottle.enabled) return { tripped: false, count: 0 };
    const key = `ab:risk:${instanceId}`;
    const now = Date.now();
    const windowMs = cfg.autoThrottle.windowSec * 1000;
    await this.redis.zadd(key, now, `${now}:${Math.random().toString(36).slice(2)}`);
    await this.redis.zremrangebyscore(key, 0, now - windowMs);
    await this.redis.pexpire(key, windowMs + 1000);
    const count = await this.redis.zcard(key);
    if (
      count >= cfg.autoThrottle.threshold &&
      (await this.redis.exists(`ab:throttle:${instanceId}`)) === 0
    ) {
      await this.redis.set(`ab:throttle:${instanceId}`, reason, 'EX', cfg.autoThrottle.cooldownSec);
      this.logger.warn(
        `[${instanceId}] AUTO-THROTTLE acionado (${count} sinais / ${cfg.autoThrottle.windowSec}s): ${reason}`,
      );
      return { tripped: true, count };
    }
    return { tripped: false, count };
  }

  /** Segundos restantes de freio (para o GET status). 0 = sem freio. */
  async throttleTtl(instanceId: string): Promise<number> {
    const ttl = await this.redis.ttl(`ab:throttle:${instanceId}`);
    return ttl > 0 ? ttl : 0;
  }
}
