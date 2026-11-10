import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/**
 * Registry distribuído de instâncias (via Redis).
 *
 * Conexões do WhatsApp são sockets stateful e long-lived: o socket da
 * instância X vive num processo (worker) específico. Este registry mapeia
 * `instância -> worker que a segura`, para que o gateway roteie cada request
 * ao worker correto e para que instâncias órfãs (worker morto) possam ser
 * reatribuídas e reconectadas a partir das credenciais persistidas.
 *
 * O "dono" tem TTL e é renovado por heartbeat; se um worker morre e para de
 * renovar, a posse expira e outro worker pode assumir.
 */
@Injectable()
export class InstanceRegistryService {
  private readonly logger = new Logger(InstanceRegistryService.name);
  private readonly workerId: string;
  private readonly ttlSeconds = 30;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService,
  ) {
    this.workerId = config.get<string>('workerId') ?? 'worker-1';
  }

  get me(): string {
    return this.workerId;
  }

  private ownerKey(instanceId: string): string {
    return `wa:registry:owner:${instanceId}`;
  }

  private workerSetKey(workerId: string): string {
    return `wa:registry:worker:${workerId}`;
  }

  /**
   * Tenta assumir a posse de uma instância. Sucede se ninguém a possui ou se
   * já pertence a este worker. Usa SET NX para evitar corrida entre workers.
   */
  async claim(instanceId: string): Promise<boolean> {
    const key = this.ownerKey(instanceId);
    const ok = await this.redis.set(key, this.workerId, 'EX', this.ttlSeconds, 'NX');
    if (ok === 'OK') {
      await this.redis.sadd(this.workerSetKey(this.workerId), instanceId);
      return true;
    }
    // Já possuído — só é "sucesso" se for por este mesmo worker.
    const current = await this.redis.get(key);
    if (current === this.workerId) {
      await this.redis.expire(key, this.ttlSeconds);
      await this.redis.sadd(this.workerSetKey(this.workerId), instanceId);
      return true;
    }
    this.logger.warn(`Instância ${instanceId} já pertence a ${current}`);
    return false;
  }

  async release(instanceId: string): Promise<void> {
    const key = this.ownerKey(instanceId);
    const current = await this.redis.get(key);
    if (current === this.workerId) {
      await this.redis.del(key);
    }
    await this.redis.srem(this.workerSetKey(this.workerId), instanceId);
  }

  async getOwner(instanceId: string): Promise<string | null> {
    return this.redis.get(this.ownerKey(instanceId));
  }

  async isMine(instanceId: string): Promise<boolean> {
    return (await this.getOwner(instanceId)) === this.workerId;
  }

  async listOwned(): Promise<string[]> {
    return this.redis.smembers(this.workerSetKey(this.workerId));
  }

  /** Renova o TTL de posse de todas as instâncias deste worker. */
  async heartbeat(): Promise<void> {
    const owned = await this.listOwned();
    if (owned.length === 0) return;
    const pipeline = this.redis.pipeline();
    for (const instanceId of owned) {
      pipeline.set(this.ownerKey(instanceId), this.workerId, 'EX', this.ttlSeconds);
    }
    await pipeline.exec();
  }
}
