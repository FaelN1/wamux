import { Injectable } from '@nestjs/common';
import { EMPTY_JID_FILTER, JidFilterConfig } from '@wamux/shared';
import { InstanceService } from '../instance/instance.service';
import { jidAllowed } from './jid-filter';

/**
 * Filtro de JIDs consultado no hot-path de cada mensagem. Cache por
 * instância com TTL curto + invalidação no save — mesmo padrão do EventBus.
 */
@Injectable()
export class JidFilterService {
  private readonly cache = new Map<string, { cfg: JidFilterConfig; ts: number }>();
  private readonly ttlMs = 10_000;

  constructor(private readonly instances: InstanceService) {}

  invalidate(instanceId: string): void {
    this.cache.delete(instanceId);
  }

  async allows(instanceId: string, jid: string, dir: 'inbound' | 'outbound'): Promise<boolean> {
    return jidAllowed(await this.configFor(instanceId), jid, dir);
  }

  private async configFor(instanceId: string): Promise<JidFilterConfig> {
    const hit = this.cache.get(instanceId);
    if (hit && Date.now() - hit.ts < this.ttlMs) return hit.cfg;
    const inst = await this.instances.findOne(instanceId).catch(() => null);
    const cfg = { ...EMPTY_JID_FILTER, ...((inst?.filters ?? {}) as Partial<JidFilterConfig>) };
    this.cache.set(instanceId, { cfg, ts: Date.now() });
    return cfg;
  }
}
