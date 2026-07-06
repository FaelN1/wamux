import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { WEBHOOK_QUEUE, WebhookEvent, WebhookJob } from './webhook.constants';

/**
 * Enfileira eventos para entrega no webhook do cliente. A entrega em si
 * (com retry/backoff/DLQ) é feita pelo WebhookProcessor, de forma assíncrona —
 * assim um webhook lento/fora do ar nunca trava o fluxo de mensagens.
 */
@Injectable()
export class WebhookService {
  constructor(
    @InjectQueue(WEBHOOK_QUEUE) private readonly queue: Queue<WebhookJob>,
  ) {}

  async dispatch(instanceId: string, event: WebhookEvent, payload: unknown): Promise<void> {
    await this.queue.add(
      event,
      { instanceId, event, payload, timestamp: Date.now() },
      { jobId: undefined },
    );
  }

  /** Itens mortos (DLQ) desta instância. */
  async listDlq(instanceId: string, limit = 50) {
    const failed = await this.queue.getFailed(0, 500);
    return failed
      .filter((j) => j.data.instanceId === instanceId)
      .slice(0, limit)
      .map((j) => ({
        id: j.id,
        event: j.data.event,
        attemptsMade: j.attemptsMade,
        failedReason: j.failedReason,
        timestamp: j.data.timestamp,
      }));
  }

  /** Reprocessa a DLQ desta instância (re-enfileira; timestamp fresco). */
  async retryDlq(instanceId: string): Promise<{ retried: number }> {
    const failed = await this.queue.getFailed(0, 1000);
    const mine = failed.filter((j) => j.data.instanceId === instanceId);
    await Promise.all(mine.map((j) => j.retry()));
    return { retried: mine.length };
  }
}
