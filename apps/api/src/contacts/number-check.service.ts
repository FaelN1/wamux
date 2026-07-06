import {
  BadRequestException,
  Inject,
  Injectable,
  NotImplementedException,
} from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { RateLimiterService } from '../throttle/rate-limiter.service';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { NumberCheckResult } from '../providers/provider.types';

/**
 * Checagem de número com proteção anti-ban: teto de lote + cache
 * Redis + rate-limit dedicado. NUNCA vira varredura em massa.
 */
@Injectable()
export class NumberCheckService {
  private static readonly MAX_PER_BATCH = 20;
  private static readonly RL = { capacity: 10, refillPerSec: 0.2 }; // ≈12/min
  private readonly cacheTtlSec = 24 * 60 * 60;

  constructor(
    private readonly manager: InstanceManagerService,
    private readonly limiter: RateLimiterService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async check(instanceId: string, numbers: string[]): Promise<NumberCheckResult[]> {
    const clean = [...new Set(numbers.map((n) => n.replace(/\D/g, '')).filter(Boolean))];
    if (clean.length === 0) throw new BadRequestException('Informe ao menos um número');
    if (clean.length > NumberCheckService.MAX_PER_BATCH) {
      throw new BadRequestException(
        `Lote acima do teto de ${NumberCheckService.MAX_PER_BATCH} (risco de ban). Divida em lotes menores.`,
      );
    }

    const provider = await this.manager.requireLive(instanceId);
    if (!provider.capabilities.checkNumbers || !provider.checkNumbers) {
      throw new NotImplementedException(
        `A engine "${provider.type}" não suporta checagem de número.`,
      );
    }

    // 1) cache: separa o que já sabemos do que precisa ir à rede.
    const out = new Map<string, NumberCheckResult>();
    const misses: string[] = [];
    for (const digits of clean) {
      const cached = await this.redis.get(this.key(instanceId, digits));
      if (cached === '1' || cached === '0') {
        out.set(digits, { input: digits, exists: cached === '1' });
      } else {
        misses.push(digits);
      }
    }

    // 2) rate-limit dedicado ANTES de consultar (freio anti-ban).
    if (misses.length > 0) {
      const { allowed, retryAfterMs } = await this.limiter.consume(
        `numcheck:${instanceId}`,
        NumberCheckService.RL.capacity,
        NumberCheckService.RL.refillPerSec,
        misses.length,
      );
      if (!allowed) {
        throw new BadRequestException(
          `Limite de checagem atingido; tente novamente em ~${Math.ceil(retryAfterMs / 1000)}s.`,
        );
      }
      const fresh = await provider.checkNumbers(misses);
      for (const r of fresh) {
        const d = r.input.replace(/\D/g, '');
        out.set(d, r);
        await this.redis.set(this.key(instanceId, d), r.exists ? '1' : '0', 'EX', this.cacheTtlSec);
      }
    }

    return clean.map((d) => out.get(d) ?? { input: d, exists: false });
  }

  private key(instanceId: string, digits: string): string {
    return `numchk:${instanceId}:${digits}`;
  }
}
