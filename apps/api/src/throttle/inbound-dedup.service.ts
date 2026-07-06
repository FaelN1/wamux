import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Dedup de ENTRADA por (instanceId, remoteJid, messageId, fromMe).
 * TTL curto: cobre a janela de reentrega/eco da lib sem descartar mensagens
 * legítimas. Só o par idêntico exato é dropado.
 */
@Injectable()
export class InboundDedupService {
  private readonly ttlSec = 60;
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** true = primeira vez (processa); false = duplicata EXATA (dropar). */
  async firstSeen(
    instanceId: string,
    remoteJid: string,
    messageId: string,
    fromMe: boolean,
  ): Promise<boolean> {
    const key = `dedup:in:${instanceId}:${remoteJid}:${messageId}:${fromMe ? 1 : 0}`;
    const ok = await this.redis.set(key, '1', 'EX', this.ttlSec, 'NX');
    return ok === 'OK';
  }
}
