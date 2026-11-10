import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';
import { HistoryImportJobEntity } from './history-job.entity';
import { HISTORY_QUEUE, HistoryImportJob } from './history.constants';
import { StartImportDto } from './dto/import-history.dto';

@Injectable()
export class HistoryService {
  constructor(
    @InjectRepository(HistoryImportJobEntity) private readonly jobs: Repository<HistoryImportJobEntity>,
    @InjectQueue(HISTORY_QUEUE) private readonly queue: Queue<HistoryImportJob>,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async start(instanceId: string, dto: StartImportDto): Promise<HistoryImportJobEntity> {
    const from = dto.from ? Date.parse(dto.from) : undefined;
    const to = dto.to ? Date.parse(dto.to) : undefined;
    const jobId = randomUUID();

    const entity = await this.jobs.save(
      this.jobs.create({
        id: jobId,
        instanceId,
        status: 'queued',
        from: from != null ? String(from) : null,
        to: to != null ? String(to) : null,
        chats: dto.chats ?? [],
        deliverToWebhook: dto.deliverToWebhook ?? false,
      }),
    );

    await this.queue.add(
      'import',
      {
        jobId,
        instanceId,
        from,
        to,
        chats: dto.chats,
        deliverToWebhook: dto.deliverToWebhook ?? false,
        pageDelayMs: 4000, // pausa entre páginas (anti-ban)
        pageSize: 50,
      },
      { jobId, attempts: 1 }, // sem retry automático: reexecutar é caro (dedup garante idempotência)
    );
    return entity;
  }

  async status(
    instanceId: string,
    jobId: string,
  ): Promise<HistoryImportJobEntity & { percent: number | null }> {
    const job = await this.jobs.findOne({ where: { id: jobId, instanceId } });
    if (!job) throw new NotFoundException(`Job de import ${jobId} não encontrado`);
    let percent: number | null = null;
    if (job.from && job.oldestReached && job.to) {
      const span = Number(job.to) - Number(job.from);
      const done = Number(job.to) - Number(job.oldestReached) * 1000;
      percent = span > 0 ? Math.min(100, Math.max(0, Math.round((done / span) * 100))) : null;
    }
    return { ...job, percent };
  }

  /** Sinaliza cancelamento — o processor checa entre páginas e encerra. */
  async cancel(instanceId: string, jobId: string): Promise<void> {
    const job = await this.jobs.findOne({ where: { id: jobId, instanceId } });
    if (!job) throw new NotFoundException(`Job de import ${jobId} não encontrado`);
    await this.redis.set(`hist:cancel:${jobId}`, '1', 'EX', 6 * 60 * 60);
  }
}
