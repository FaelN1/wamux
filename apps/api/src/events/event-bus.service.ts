import { Injectable } from '@nestjs/common';
import type { InstanceEventsConfig } from '@wamux/shared';
import { InstanceService } from '../instance/instance.service';
import { EventsWsGateway } from './events-ws.gateway';
import { RabbitmqService } from './rabbitmq.service';

/**
 * Fan-out dos eventos para os transportes de STREAM (WebSocket + RabbitMQ).
 * O Webhook continua no fluxo próprio (fila BullMQ → WebhookProcessor); aqui
 * cuidamos só dos que empurram/publicam na hora. Cada transporte respeita seu
 * `enabled` + filtro de eventos. A config é cacheada por instância (TTL curto)
 * e invalidada quando o usuário salva no painel.
 */
@Injectable()
export class EventBusService {
  private readonly cache = new Map<string, { cfg: InstanceEventsConfig; ts: number }>();
  private readonly ttlMs = 10_000;

  constructor(
    private readonly instances: InstanceService,
    private readonly ws: EventsWsGateway,
    private readonly rabbit: RabbitmqService,
  ) {}

  /** Descarta o cache de uma instância (chamado ao salvar a config). */
  invalidate(instanceId: string): void {
    this.cache.delete(instanceId);
  }

  async emit(instanceId: string, event: string, payload: unknown): Promise<void> {
    const cfg = await this.configFor(instanceId);
    if (!cfg) return;

    if (cfg.websocket.enabled && this.allowed(cfg.websocket.events, event)) {
      this.ws.push(instanceId, event, payload);
    }
    if (cfg.rabbitmq.enabled && this.allowed(cfg.rabbitmq.events, event)) {
      this.rabbit.publish(instanceId, event, payload);
    }
  }

  private allowed(events: string[], event: string): boolean {
    return events.length === 0 || events.includes(event);
  }

  private async configFor(instanceId: string): Promise<InstanceEventsConfig | null> {
    const hit = this.cache.get(instanceId);
    if (hit && Date.now() - hit.ts < this.ttlMs) return hit.cfg;
    const inst = await this.instances.findOne(instanceId).catch(() => null);
    if (!inst) return null;
    const cfg = this.instances.effectiveEvents(inst);
    this.cache.set(instanceId, { cfg, ts: Date.now() });
    return cfg;
  }
}
