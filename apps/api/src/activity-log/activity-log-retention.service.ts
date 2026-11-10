import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ActivityLogEntity } from './activity-log.entity';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // de hora em hora — retenção é em dias
const BATCH_SIZE = 1000; // evita carregar um backlog gigante de uma vez na primeira ativação

/**
 * Higiene do painel de Logs (§8/§10 fase 6 — `docs/logs-painel-handoff.md`):
 * `activityLog.retentionDays` > 0 arma um expurgo periódico de linhas
 * antigas. Mesmo padrão exato do `InboxRetentionService` (`setInterval` em
 * `onApplicationBootstrap`, sem `@nestjs/schedule`) — sem recálculo de
 * denormalização (diferente do Inbox, `activity_logs` é um audit trail
 * plano, sem `lastMessage*` pra manter consistente).
 *
 * `0` (default) = sem expurgo, nem arma o timer.
 */
@Injectable()
export class ActivityLogRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ActivityLogRetentionService.name);
  private timer?: NodeJS.Timeout;
  private readonly retentionDays: number;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ActivityLogEntity) private readonly repo: Repository<ActivityLogEntity>,
  ) {
    this.retentionDays = this.config.get<number>('activityLog.retentionDays') ?? 0;
  }

  onApplicationBootstrap(): void {
    if (this.retentionDays <= 0) return;
    this.timer = setInterval(() => {
      this.purge().catch((e) =>
        this.logger.error(`expurgo de retenção falhou: ${(e as Error).message}`),
      );
    }, CHECK_INTERVAL_MS);
    // roda uma vez já no boot — não espera 1h pro primeiro expurgo.
    void this.purge().catch((e) =>
      this.logger.error(`expurgo inicial falhou: ${(e as Error).message}`),
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Expurga eventos mais velhos que `retentionDays`, em lotes de `BATCH_SIZE`. */
  async purge(): Promise<{ purged: number }> {
    if (this.retentionDays <= 0) return { purged: 0 };
    const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000);
    let purged = 0;

    for (;;) {
      const expiring = await this.repo.find({
        where: { createdAt: LessThan(cutoff) },
        select: ['id'],
        take: BATCH_SIZE,
      });
      if (expiring.length === 0) break;

      await this.repo.delete(expiring.map((r) => r.id));
      purged += expiring.length;
      if (expiring.length < BATCH_SIZE) break; // última leva
    }

    if (purged > 0) {
      this.logger.log(`Expurgo de retenção do painel de Logs: ${purged} eventos removidos`);
    }
    return { purged };
  }
}
