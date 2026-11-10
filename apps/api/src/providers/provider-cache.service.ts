import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import type { ProviderCache } from './provider.interface';

/** Escapa os metacaracteres de glob do `SCAN MATCH` (`* ? [ ] \`). */
function escapeGlob(value: string): string {
  return value.replace(/[\\*?[\]]/g, '\\$&');
}

/**
 * `ProviderCache` em cima do cliente Redis compartilhado. A factory chama
 * `forInstance()` ao montar o contexto de cada adapter; as chaves saem como
 * `pcache:<instanceId>:<chave do adapter>`, então um adapter nunca lê nem
 * apaga o que é de outra instância.
 *
 * Como o estado vive no Redis (e não no processo), ele sobrevive a restart e
 * acompanha a instância quando outro worker a assume.
 */
@Injectable()
export class ProviderCacheService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  forInstance(instanceId: string): ProviderCache {
    const redis = this.redis;
    const ns = `pcache:${instanceId}:`;

    return {
      get: (key) => redis.get(ns + key),

      set: async (key, value, ttlSec) => {
        const ttl = Math.floor(ttlSec);
        if (!(ttl > 0)) return; // sem validade não grava — nada aqui é eterno
        await redis.set(ns + key, value, 'EX', ttl);
      },

      del: async (key) => {
        await redis.del(ns + key);
      },

      clear: async (prefix = '') => {
        // SCAN (não KEYS): não trava o Redis mesmo com muitas chaves.
        const match = `${escapeGlob(ns + prefix)}*`;
        let cursor = '0';
        do {
          const [next, keys] = await redis.scan(cursor, 'MATCH', match, 'COUNT', 500);
          cursor = next;
          if (keys.length) await redis.unlink(...keys);
        } while (cursor !== '0');
      },
    };
  }
}
