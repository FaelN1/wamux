import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DelayedError, Job } from 'bullmq';
import axios from 'axios';
import { Repository } from 'typeorm';
import { InstanceEntity } from '../instance/instance.entity';
import { SettingsService } from '../settings/settings.service';
import { signWebhook } from './signature';
import { WebhookCircuitBreakerService } from './circuit-breaker.service';
import { WEBHOOK_QUEUE, WebhookJob } from './webhook.constants';

/**
 * Worker BullMQ que entrega os eventos no webhook configurado da instância.
 *
 * Robustez: se a entrega falhar (timeout, 5xx), lança erro e o BullMQ
 * re-tenta com backoff exponencial (config global em app.module). Após esgotar
 * as tentativas, o job vai para a DLQ (removeOnFail mantém histórico).
 */
@Processor(WEBHOOK_QUEUE, { concurrency: 20 })
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    @InjectRepository(InstanceEntity)
    private readonly instances: Repository<InstanceEntity>,
    private readonly settings: SettingsService,
    private readonly breaker: WebhookCircuitBreakerService,
  ) {
    super();
  }

  async process(job: Job<WebhookJob>, token?: string): Promise<void> {
    const { instanceId, event, payload, timestamp } = job.data;

    const instance = await this.instances.findOne({ where: { id: instanceId } });
    if (!instance) return;

    // URL da instância; senão, cai no webhook global (se habilitado).
    const globalWebhook = this.settings.get().webhookGlobal;
    const targetUrl =
      instance.webhookUrl || (globalWebhook.enabled ? globalWebhook.url : '');
    if (!targetUrl) {
      // Sem webhook (nem próprio nem global): descarta silenciosamente.
      return;
    }

    // Filtro opcional de eventos (só se a instância tem webhook próprio).
    if (instance.webhookUrl && instance.webhookEvents?.length && !instance.webhookEvents.includes(event)) {
      return;
    }

    // Serializa NÓS MESMOS uma vez e assinamos ESSES bytes — passar a
    // string crua ao axios garante que os bytes recebidos são os assinados.
    const rawBody = JSON.stringify({
      instanceId,
      instanceName: instance.name,
      provider: instance.provider,
      event,
      data: payload,
      timestamp,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (instance.webhookSecret) {
      // `t` vem do timestamp do job (estável entre retries → idempotência).
      const t = Math.floor(timestamp / 1000);
      headers['X-WAMux-Signature'] = signWebhook(instance.webhookSecret, rawBody, t);
    }

    // Circuit breaker por host: não martela URL sabidamente morta.
    const cbKey = new URL(targetUrl).host;
    if ((await this.breaker.state(cbKey)) === 'open') {
      await job.moveToDelayed(Date.now() + this.breaker.cooldownMs, token);
      throw new DelayedError(); // reprograma sem gastar tentativa
    }

    try {
      await axios.post(targetUrl, rawBody, { timeout: 15_000, headers });
      await this.breaker.onSuccess(cbKey);
    } catch (err) {
      await this.breaker.onFailure(cbKey);
      throw err; // BullMQ aplica backoff → DLQ ao esgotar
    }

    this.logger.debug(`webhook ${event} -> ${targetUrl} (tentativa ${job.attemptsMade + 1})`);
  }
}
