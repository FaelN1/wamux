import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { Repository } from 'typeorm';
import { HistoryBatch, HistoryCursor, MessageAckStatus, NormalizedMessage } from '@wamux/shared';
import { REDIS_CLIENT } from '../redis/redis.module';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WebhookService } from '../webhook/webhook.service';
import { WebhookEvent } from '../webhook/webhook.constants';
import { MessageLogEntity } from '../messaging/message-log.entity';
import { HistoryImportJobEntity } from './history-job.entity';
import { HISTORY_QUEUE, HistoryImportJob } from './history.constants';

/**
 * Worker de import de histórico. Roda no mesmo processo que segura o
 * provider vivo, então assina `history` direto. Paginação COM PAUSA (anti-ban).
 */
@Processor(HISTORY_QUEUE, { concurrency: 2 })
export class HistoryImportProcessor extends WorkerHost {
  private readonly logger = new Logger(HistoryImportProcessor.name);

  constructor(
    private readonly manager: InstanceManagerService,
    private readonly webhooks: WebhookService,
    @InjectRepository(HistoryImportJobEntity) private readonly jobs: Repository<HistoryImportJobEntity>,
    @InjectRepository(MessageLogEntity) private readonly logs: Repository<MessageLogEntity>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {
    super();
  }

  async process(job: Job<HistoryImportJob>): Promise<void> {
    const { jobId, instanceId, from, to, chats, deliverToWebhook, pageDelayMs, pageSize } = job.data;
    await this.jobs.update({ id: jobId }, { status: 'running' });

    const provider = await this.manager.requireLive(instanceId);
    if (!provider.requestHistorySync) {
      await this.finish(jobId, 'failed', 'Engine não suporta importar histórico (ex.: Cloud API).');
      return;
    }
    const requestSync = provider.requestHistorySync.bind(provider);

    const cursors = new Map<string, HistoryCursor>();
    let imported = 0;
    let duplicates = 0;
    let oldestSeen = Number.MAX_SAFE_INTEGER;
    let latest = false;

    const collector = (batch: HistoryBatch): void => {
      void (async () => {
        for (const m of batch.messages) {
          if (chats?.length && !chats.includes(m.chatId)) continue;
          const tsMs = m.timestamp * 1000;
          if (from != null && tsMs < from) continue;
          if (to != null && tsMs > to) continue;
          const inserted = await this.persist(instanceId, m);
          if (inserted) {
            imported++;
            if (deliverToWebhook) {
              void this.webhooks.dispatch(instanceId, WebhookEvent.MESSAGE_RECEIVED, {
                ...m,
                historical: true,
              });
            }
          } else {
            duplicates++;
          }
          const cur = cursors.get(m.chatId);
          if (!cur || m.timestamp < cur.timestamp) {
            cursors.set(m.chatId, { id: m.id, fromMe: m.fromMe, timestamp: m.timestamp });
          }
          oldestSeen = Math.min(oldestSeen, m.timestamp);
        }
        if (batch.isLatest) latest = true;
        await this.jobs.update(
          { id: jobId },
          { imported, duplicates, oldestReached: String(oldestSeen) },
        );
      })();
    };

    provider.on('history', collector);
    try {
      const targets = chats?.length ? chats : [undefined];
      for (const chatId of targets) {
        let empties = 0;
        for (let page = 0; page < 40; page++) {
          if (await this.isCanceled(jobId)) {
            await this.finish(jobId, 'canceled', 'Cancelado pelo usuário.');
            return;
          }
          const before = chatId ? cursors.get(chatId) : undefined;
          const beforeCount = imported + duplicates;
          const { requested } = await requestSync({ chatId, count: pageSize, before });
          if (!requested) break;
          await this.sleep(pageDelayMs);
          const progressed = imported + duplicates - beforeCount;
          if (progressed === 0 && ++empties >= 2) break;
          if (latest) break;
          if (from != null && chatId && (cursors.get(chatId)?.timestamp ?? 0) * 1000 <= from) break;
        }
        await this.jobs.increment({ id: jobId }, 'chatsProcessed', 1);
      }
      const reachedFrom = from == null || oldestSeen * 1000 <= from || latest;
      await this.finish(
        jobId,
        reachedFrom ? 'done' : 'partial',
        reachedFrom
          ? null
          : 'A engine parou de entregar histórico antes de cobrir todo o intervalo (best-effort).',
      );
    } catch (e) {
      await this.finish(jobId, 'failed', (e as Error).message);
    } finally {
      provider.off('history', collector);
    }
  }

  /** INSERT ON CONFLICT DO NOTHING → true se inseriu (novo), false se duplicado. */
  private async persist(instanceId: string, m: NormalizedMessage): Promise<boolean> {
    const res = await this.logs
      .createQueryBuilder()
      .insert()
      .values({
        id: m.id,
        instanceId,
        chatId: m.chatId,
        fromMe: m.fromMe,
        type: m.type,
        text: m.text ?? null,
        ack: MessageAckStatus.DELIVERED,
        source: 'import',
        timestamp: String(m.timestamp),
      })
      .orIgnore()
      .execute();
    return (res.identifiers?.length ?? 0) > 0 || ((res.raw as unknown[])?.length ?? 0) > 0;
  }

  private async isCanceled(jobId: string): Promise<boolean> {
    return (await this.redis.exists(`hist:cancel:${jobId}`)) === 1;
  }
  private async finish(
    jobId: string,
    status: HistoryImportJobEntity['status'],
    message: string | null,
  ): Promise<void> {
    await this.jobs.update({ id: jobId }, { status, message });
  }
  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
