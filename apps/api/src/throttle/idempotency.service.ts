import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

export type IdempotencyState =
  | { status: 'new' }
  | { status: 'in_progress' }
  | { status: 'done'; result: string };

/**
 * Idempotência de envio via Redis. O cliente manda um `clientMessageId`; se a
 * mesma chave chegar de novo (retry do cliente, reentrega de fila), não
 * reenviamos a mensagem — devolvemos o resultado anterior.
 */
@Injectable()
export class IdempotencyService {
  private readonly ttlSec = 24 * 60 * 60; // 24h

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private k(key: string): string {
    return `idem:${key}`;
  }

  /** Marca a chave como "em progresso" se for nova. Retorna o estado atual. */
  async begin(key: string): Promise<IdempotencyState> {
    const ok = await this.redis.set(this.k(key), 'in_progress', 'EX', this.ttlSec, 'NX');
    if (ok === 'OK') return { status: 'new' };
    const current = await this.redis.get(this.k(key));
    if (!current || current === 'in_progress') return { status: 'in_progress' };
    return { status: 'done', result: current };
  }

  async complete(key: string, result: string): Promise<void> {
    await this.redis.set(this.k(key), result, 'EX', this.ttlSec);
  }

  /** Libera a chave (ex.: envio falhou e queremos permitir nova tentativa). */
  async release(key: string): Promise<void> {
    await this.redis.del(this.k(key));
  }
}
