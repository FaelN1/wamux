import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Rate limiter por chave (ex.: por instância) via **token bucket** no Redis.
 * Atômico (script Lua) e distribuído — funciona igual em multi-worker.
 *
 * Anti-ban: espaça os envios de cada instância a um ritmo sustentável, com
 * uma pequena rajada (burst) permitida.
 */
@Injectable()
export class RateLimiterService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  // KEYS[1]=bucket | ARGV: capacity, refillPerSec, cost, nowMs
  private static readonly LUA = `
    local key = KEYS[1]
    local capacity = tonumber(ARGV[1])
    local refill = tonumber(ARGV[2])
    local cost = tonumber(ARGV[3])
    local now = tonumber(ARGV[4])
    local d = redis.call('HMGET', key, 'tokens', 'ts')
    local tokens = tonumber(d[1])
    local ts = tonumber(d[2])
    if tokens == nil then tokens = capacity; ts = now end
    local elapsed = math.max(0, now - ts) / 1000.0
    tokens = math.min(capacity, tokens + elapsed * refill)
    local allowed = 0
    local retry = 0
    if tokens >= cost then
      tokens = tokens - cost
      allowed = 1
    else
      retry = math.ceil((cost - tokens) / refill * 1000)
    end
    redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
    redis.call('PEXPIRE', key, math.ceil(capacity / refill * 1000) + 1000)
    return {allowed, retry}
  `;

  /**
   * Tenta consumir `cost` tokens do bucket `key`.
   * @returns allowed + retryAfterMs (quanto esperar quando bloqueado).
   */
  async consume(
    key: string,
    capacity: number,
    refillPerSec: number,
    cost = 1,
  ): Promise<{ allowed: boolean; retryAfterMs: number }> {
    const [allowed, retry] = (await this.redis.eval(
      RateLimiterService.LUA,
      1,
      `rl:${key}`,
      capacity,
      refillPerSec,
      cost,
      Date.now(),
    )) as [number, number];
    return { allowed: allowed === 1, retryAfterMs: retry };
  }
}
