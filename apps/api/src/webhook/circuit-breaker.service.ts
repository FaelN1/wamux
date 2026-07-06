import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export type BreakerState = 'closed' | 'open' | 'half-open';

/**
 * Circuit breaker por HOST de webhook. Estado no Redis (distribuído):
 * abre após N falhas na janela; após o cooldown entra em meia-aberta.
 */
@Injectable()
export class WebhookCircuitBreakerService {
  private readonly threshold = 5; // falhas p/ abrir
  private readonly windowSec = 60; // janela de contagem
  readonly cooldownMs = 30_000; // tempo aberto antes da meia-abertura

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  async state(key: string): Promise<BreakerState> {
    const openUntil = Number(await this.redis.get(`cb:${key}:open`));
    if (!openUntil) return 'closed';
    return Date.now() < openUntil ? 'open' : 'half-open';
  }

  async onSuccess(key: string): Promise<void> {
    await this.redis.del(`cb:${key}:open`, `cb:${key}:fails`);
  }

  async onFailure(key: string): Promise<void> {
    const fails = await this.redis.incr(`cb:${key}:fails`);
    if (fails === 1) await this.redis.expire(`cb:${key}:fails`, this.windowSec);
    if (fails >= this.threshold) {
      await this.redis.set(`cb:${key}:open`, String(Date.now() + this.cooldownMs), 'PX', this.cooldownMs);
    }
  }
}
