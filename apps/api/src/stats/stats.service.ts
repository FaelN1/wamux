import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { MoreThanOrEqual, Repository } from 'typeorm';
import { Queue } from 'bullmq';
import { StatsMessages, StatsOverview, StatsWebhooks } from '@wamux/shared';
import { MessageLogEntity } from '../messaging/message-log.entity';
import { WEBHOOK_QUEUE } from '../webhook/webhook.constants';

const DAY_MS = 86_400_000;

/** Agrega métricas para a dashboard. Leitura pura — não altera nada. */
@Injectable()
export class StatsService {
  constructor(
    @InjectRepository(MessageLogEntity) private readonly logs: Repository<MessageLogEntity>,
    @InjectQueue(WEBHOOK_QUEUE) private readonly webhookQueue: Queue,
  ) {}

  async overview(): Promise<StatsOverview> {
    const [messages, webhooks] = await Promise.all([this.messageStats(), this.webhookStats()]);
    return { messages, webhooks, generatedAt: new Date().toISOString() };
  }

  private async messageStats(): Promise<StatsMessages> {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const d7 = new Date(Date.now() - 7 * DAY_MS);
    const d14 = new Date(Date.now() - 14 * DAY_MS);

    const [sent, received, todaySent, todayReceived, w7Sent, w7Received] = await Promise.all([
      this.logs.count({ where: { fromMe: true } }),
      this.logs.count({ where: { fromMe: false } }),
      this.logs.count({ where: { fromMe: true, createdAt: MoreThanOrEqual(startOfToday) } }),
      this.logs.count({ where: { fromMe: false, createdAt: MoreThanOrEqual(startOfToday) } }),
      this.logs.count({ where: { fromMe: true, createdAt: MoreThanOrEqual(d7) } }),
      this.logs.count({ where: { fromMe: false, createdAt: MoreThanOrEqual(d7) } }),
    ]);

    // funil de ack das enviadas
    const ack = { pending: 0, server: 0, delivered: 0, read: 0, played: 0, failed: 0 };
    const ackRows: Array<{ ack: string; count: number }> = await this.logs.query(
      'SELECT ack, COUNT(*)::int AS count FROM message_logs WHERE "fromMe" = true GROUP BY ack',
    );
    const ackMap: Record<string, keyof typeof ack> = {
      pending: 'pending',
      server_ack: 'server',
      delivered: 'delivered',
      read: 'read',
      played: 'played',
      failed: 'failed',
    };
    for (const r of ackRows) {
      const key = ackMap[r.ack];
      if (key) ack[key] = Number(r.count);
    }
    const reached = ack.server + ack.delivered + ack.read + ack.played;
    const deliveredCount = ack.delivered + ack.read + ack.played;
    const readCount = ack.read + ack.played;

    // série diária (14d)
    const perDayRows: Array<{ date: string; sent: number; received: number }> =
      await this.logs.query(
        `SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS date,
              SUM(CASE WHEN "fromMe" THEN 1 ELSE 0 END)::int AS sent,
              SUM(CASE WHEN NOT "fromMe" THEN 1 ELSE 0 END)::int AS received
       FROM message_logs WHERE "createdAt" >= $1 GROUP BY 1 ORDER BY 1`,
        [d14],
      );

    return {
      total: sent + received,
      sent,
      received,
      today: { sent: todaySent, received: todayReceived },
      last7d: { sent: w7Sent, received: w7Received },
      ack,
      deliveryRate: reached ? deliveredCount / reached : 0,
      readRate: reached ? readCount / reached : 0,
      perDay: perDayRows.map((r) => ({
        date: r.date,
        sent: Number(r.sent),
        received: Number(r.received),
      })),
    };
  }

  private async webhookStats(): Promise<StatsWebhooks> {
    const c = await this.webhookQueue.getJobCounts(
      'completed',
      'failed',
      'active',
      'waiting',
      'delayed',
    );
    const delivered = c.completed ?? 0;
    const failed = c.failed ?? 0;
    const pending = (c.active ?? 0) + (c.waiting ?? 0) + (c.delayed ?? 0);
    const total = delivered + failed;
    return { delivered, failed, pending, dlq: failed, successRate: total ? delivered / total : 1 };
  }
}
