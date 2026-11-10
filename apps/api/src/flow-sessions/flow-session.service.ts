import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { FlowResponse, FlowSessionStatus } from '../providers/provider.types';
import { FlowSessionEntity } from './flow-session.entity';

const RETENTION_CHECK_MS = 60 * 60 * 1000;

export interface FlowSessionSent {
  flowToken: string;
  flowId?: string;
  flowName?: string;
  contact?: string;
  messageId?: string;
  mode?: string;
}

export interface FlowSessionFilter {
  status?: FlowSessionStatus;
  contact?: string;
  flowId?: string;
  limit?: number;
  /** cursor: só sessões criadas ANTES deste instante (ISO). */
  before?: string;
}

/**
 * Persistência das execuções de Flow — correlaciona instância ↔ contato ↔
 * mensagem ↔ Flow ↔ resposta pelo `flowToken`. Todas as escritas são upserts
 * idempotentes: a Meta reentrega webhooks e o envio pode ser repetido.
 *
 * `FLOWS_SAVE_RESPONSE_DATA=false` mantém só os metadados de correlação (o
 * conteúdo da resposta segue apenas no webhook, sem ficar at-rest).
 */
@Injectable()
export class FlowSessionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(FlowSessionService.name);
  private readonly saveResponseData: boolean;
  private readonly retentionDays: number;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectRepository(FlowSessionEntity) private readonly repo: Repository<FlowSessionEntity>,
    config: ConfigService,
  ) {
    this.saveResponseData = config.get<boolean>('flows.saveResponseData') ?? true;
    this.retentionDays = config.get<number>('flows.sessionRetentionDays') ?? 0;
  }

  onApplicationBootstrap(): void {
    if (this.retentionDays <= 0) return;
    const run = () =>
      this.purge().catch((e) => this.logger.error(`expurgo falhou: ${(e as Error).message}`));
    this.timer = setInterval(run, RETENTION_CHECK_MS);
    void run();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async purge(): Promise<number> {
    if (this.retentionDays <= 0) return 0;
    const cutoff = new Date(Date.now() - this.retentionDays * 86_400_000);
    const res = await this.repo.delete({ createdAt: LessThan(cutoff) });
    return res.affected ?? 0;
  }

  /** Flow enviado: abre (ou reaproveita) a sessão do token. */
  async recordSent(instanceId: string, sent: FlowSessionSent): Promise<void> {
    await this.upsert(instanceId, sent.flowToken, (s) => {
      s.flowId = sent.flowId ?? s.flowId;
      s.flowName = sent.flowName ?? s.flowName;
      s.contact = sent.contact ?? s.contact;
      s.messageId = sent.messageId ?? s.messageId;
      s.mode = sent.mode ?? s.mode;
    });
  }

  /** Chamada ao endpoint de troca de dados (INIT/BACK/data_exchange). */
  async recordExchange(
    instanceId: string,
    flowToken: string,
    action: string,
    screen?: string,
  ): Promise<void> {
    await this.upsert(instanceId, flowToken, (s) => {
      s.lastAction = action;
      s.lastScreen = screen ?? s.lastScreen;
      s.exchanges = (s.exchanges ?? 0) + 1;
      if (s.status === 'sent') s.status = 'in_progress';
    });
  }

  /** Erro reportado pelo cliente WhatsApp (notificação) ou pelo endpoint do integrador. */
  async recordError(
    instanceId: string,
    flowToken: string,
    error: Record<string, unknown>,
  ): Promise<void> {
    await this.upsert(instanceId, flowToken, (s) => {
      s.error = error;
      if (s.status !== 'completed') s.status = 'failed';
    });
  }

  /** Resposta final (`nfm_reply`). Idempotente por `responseMessageId`. */
  async complete(
    instanceId: string,
    response: FlowResponse,
    meta: { messageId: string; contact?: string },
  ): Promise<void> {
    if (!response.flowToken) return; // sem token não há o que correlacionar
    await this.upsert(instanceId, response.flowToken, (s) => {
      s.status = 'completed';
      s.responseMessageId = meta.messageId;
      s.contact = s.contact ?? meta.contact;
      s.completedAt = s.completedAt ?? new Date();
      if (this.saveResponseData) s.response = response.data;
    });
  }

  async get(instanceId: string, flowToken: string): Promise<FlowSessionEntity | null> {
    return this.repo.findOne({ where: { instanceId, flowToken } });
  }

  async list(instanceId: string, f: FlowSessionFilter = {}): Promise<FlowSessionEntity[]> {
    const before = f.before ? new Date(f.before) : undefined;
    return this.repo.find({
      where: {
        instanceId,
        ...(f.status ? { status: f.status } : {}),
        ...(f.contact ? { contact: f.contact.replace(/\D/g, '') } : {}),
        ...(f.flowId ? { flowId: f.flowId } : {}),
        ...(before && !Number.isNaN(before.getTime()) ? { createdAt: LessThan(before) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: Math.min(Math.max(f.limit ?? 50, 1), 200),
    });
  }

  /**
   * Lê-modifica-grava sob a chave única (instanceId, flowToken). Em corrida de
   * criação (dois eventos do mesmo token chegando juntos) a segunda inserção
   * viola o índice único — relê e aplica sobre a linha vencedora.
   */
  private async upsert(
    instanceId: string,
    flowToken: string,
    mutate: (s: FlowSessionEntity) => void,
  ): Promise<void> {
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const existing = await this.repo.findOne({ where: { instanceId, flowToken } });
        const row =
          existing ?? this.repo.create({ instanceId, flowToken, status: 'sent', exchanges: 0 });
        mutate(row);
        try {
          await this.repo.save(row);
          return;
        } catch (e) {
          if (existing || attempt === 1) throw e;
        }
      }
    } catch (e) {
      // Correlação é best-effort: nunca derruba o envio nem o webhook.
      this.logger.error(`flow session ${instanceId}/${flowToken}: ${(e as Error).message}`);
    }
  }
}
