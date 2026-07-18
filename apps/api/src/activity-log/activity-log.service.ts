import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ActivityLogEntity } from './activity-log.entity';
import { toActivityLogEntry } from './activity-log.mapper';
import { InstanceEntity } from '../instance/instance.entity';
import { EventsWsGateway } from '../events/events-ws.gateway';

export interface RecordActivityInput {
  instanceId?: string | null;
  type: ActivityLogEntity['type'];
  status: ActivityLogEntity['status'];
  activity: string;
  method?: string | null;
  route?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
  platform?: string | null;
  apiKeyLabel?: string | null;
  message?: string | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Escrita do painel de Logs/Atividade — gated por `activityLog.enabled`
 * (opt-in, default off). Nunca lança: um erro ao gravar log NUNCA pode
 * derrubar o request/evento que está sendo logado (mesmo princípio do
 * `InboxStoreService`).
 */
@Injectable()
export class ActivityLogService {
  private readonly logger = new Logger(ActivityLogService.name);
  private readonly platformCache = new Map<string, { provider: string; ts: number }>();
  private readonly platformCacheTtlMs = 30_000;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ActivityLogEntity) private readonly repo: Repository<ActivityLogEntity>,
    @InjectRepository(InstanceEntity) private readonly instances: Repository<InstanceEntity>,
    private readonly ws: EventsWsGateway,
  ) {}

  get enabled(): boolean {
    return this.config.get<boolean>('activityLog.enabled') ?? false;
  }

  async record(input: RecordActivityInput): Promise<void> {
    if (!this.enabled) return;
    try {
      const row = await this.repo.save(this.repo.create(input));
      this.ws.broadcastAll('activity.created', toActivityLogEntry(row));
    } catch (e) {
      this.logger.warn(`falha ao gravar activity log: ${(e as Error).message}`);
    }
  }

  /** `ProviderType` da instância — cache curto, direto do repositório (não do worker atual). */
  async platformFor(instanceId: string): Promise<string | undefined> {
    const hit = this.platformCache.get(instanceId);
    if (hit && Date.now() - hit.ts < this.platformCacheTtlMs) return hit.provider;
    const inst = await this.instances.findOne({ where: { id: instanceId } }).catch(() => null);
    if (!inst) return undefined;
    this.platformCache.set(instanceId, { provider: inst.provider, ts: Date.now() });
    return inst.provider;
  }
}
