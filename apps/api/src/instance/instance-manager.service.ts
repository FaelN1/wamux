import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  forwardRef,
} from '@nestjs/common';
import { EventBusService } from '../events/event-bus.service';
import { PollStore } from '../messaging/poll-store.service';
import { PollVoteUpdate } from '../providers/provider.types';
import { JidFilterService } from '../common/jid-filter.service';
import { MessageLogService } from '../messaging/message-log.service';
import { InboundDedupService } from '../throttle/inbound-dedup.service';
import { AntiBanService } from '../throttle/anti-ban.service';
import { RiskMonitorService } from '../throttle/risk-monitor.service';
import { MediaService } from '../media/media.service';
import { InboxStoreService } from '../inbox/inbox-store.service';
import { AntiBanConfig } from '@wamux/shared';
import { ProviderFactory } from '../providers/provider.factory';
import { InstanceRegistryService } from '../providers/instance-registry.service';
import { WhatsAppProvider, WebhookPassthrough } from '../providers/provider.interface';
import {
  ConnectionStatus,
  ConnectionUpdate,
  MessageStatusUpdate,
  NormalizedMessage,
  PortableCredentials,
  ProviderType,
} from '../providers/provider.types';
import { SessionService } from '../session/session.service';
import { WebhookService } from '../webhook/webhook.service';
import { WebhookEvent } from '../webhook/webhook.constants';
import { InstanceService } from './instance.service';
import { InstanceEntity } from './instance.entity';

/**
 * Motor de runtime: mantém em memória os providers VIVOS deste worker,
 * conecta seus eventos aos webhooks e coordena posse via Instance Registry.
 *
 * - onModuleInit: religa instâncias que estavam ativas e que este worker
 *   consegue assumir (reconexão a partir das credenciais persistidas).
 * - onApplicationShutdown: desconecta limpo (sem deslogar) e libera o registry.
 */
@Injectable()
export class InstanceManagerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(InstanceManagerService.name);
  private readonly live = new Map<string, WhatsAppProvider>();
  private heartbeatTimer?: NodeJS.Timeout;

  // Política de reconexão: backoff exponencial + jitter por instância.
  private readonly reconnect = new Map<string, { attempts: number; timer?: NodeJS.Timeout }>();
  private readonly maxReconnectAttempts = 8;
  private readonly baseDelayMs = 1_000;
  private readonly maxDelayMs = 60_000;

  constructor(
    private readonly factory: ProviderFactory,
    private readonly registry: InstanceRegistryService,
    private readonly sessions: SessionService,
    private readonly webhooks: WebhookService,
    private readonly instances: InstanceService,
    @Inject(forwardRef(() => EventBusService))
    private readonly eventBus: EventBusService,
    private readonly pollStore: PollStore,
    private readonly jidFilter: JidFilterService,
    private readonly messageLog: MessageLogService,
    private readonly dedup: InboundDedupService,
    private readonly antiBan: AntiBanService,
    private readonly riskMonitor: RiskMonitorService,
    private readonly media: MediaService,
    private readonly inboxStore: InboxStoreService,
  ) {}

  /** Registra um sinal de risco e emite ANTIBAN_ALERT se armar o freio. */
  private async reportRisk(instanceId: string, reason: string): Promise<void> {
    const inst = await this.instances.findOne(instanceId).catch(() => null);
    if (!inst) return;
    const cfg = this.antiBan.resolve(inst.config.antiBan as Partial<AntiBanConfig>);
    const { tripped } = await this.riskMonitor.record(instanceId, cfg, reason);
    if (tripped) {
      const rate = await this.antiBan.rate(instanceId, cfg);
      this.fanOut(instanceId, WebhookEvent.ANTIBAN_ALERT, {
        reason,
        throttled: true,
        cooldownSec: cfg.autoThrottle.cooldownSec,
        reducedRate: rate,
      });
    }
  }

  /** Invalida o cache de config de eventos (chamado ao salvar no painel). */
  refreshEventsConfig(instanceId: string): void {
    this.eventBus.invalidate(instanceId);
  }

  async onModuleInit(): Promise<void> {
    // Renova a posse das instâncias deste worker periodicamente (leve).
    this.heartbeatTimer = setInterval(() => {
      this.registry.heartbeat().catch((e) => this.logger.error((e as Error).message));
    }, 10_000);

    // Boot NÃO-BLOQUEANTE: religa instâncias em background — o Nest
    // não espera WhatsApp para dar app.listen(); /api/health fica verde em
    // segundos independentemente do nº de sessões a reconectar.
    void this.reconnectActiveInstances();
  }

  /** Religa, sem bloquear o boot, tudo que estava ativo e este worker consegue assumir. */
  private async reconnectActiveInstances(): Promise<void> {
    try {
      const all = await this.instances.findAll();
      for (const inst of all) {
        // Só religa o que estava ativo — não força reconexão de tudo.
        const wasActive =
          inst.status === ConnectionStatus.CONNECTED || inst.status === ConnectionStatus.QR;
        if (!wasActive) continue;
        try {
          if (await this.registry.claim(inst.id)) {
            const provider = await this.spawn(inst);
            await provider.initialize();
            this.logger.log(`Religada instância ${inst.name} (${inst.provider})`);
          }
        } catch (e) {
          this.logger.error(`Falha ao religar ${inst.name}: ${(e as Error).message}`);
        }
      }
    } catch (e) {
      this.logger.error(`Religação em background falhou: ${(e as Error).message}`);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const [id, provider] of this.live) {
      try {
        await provider.destroy(); // libera socket/browser sem deslogar
        await this.registry.release(id);
      } catch (e) {
        this.logger.error(`shutdown ${id}: ${(e as Error).message}`);
      }
    }
    this.live.clear();
  }

  /** Provider vivo neste worker (ou undefined se não estiver aqui). */
  getLive(instanceId: string): WhatsAppProvider | undefined {
    return this.live.get(instanceId);
  }

  /**
   * Garante instância possuída por este worker e com provider inicializado.
   * Se outro worker já a segura, orienta o roteamento (multi-worker).
   */
  async ensureConnected(instanceId: string): Promise<WhatsAppProvider> {
    const existing = this.live.get(instanceId);
    if (existing) return existing;

    const inst = await this.instances.findOne(instanceId);
    if (!(await this.registry.claim(instanceId))) {
      const owner = await this.registry.getOwner(instanceId);
      throw new ConflictException(
        `Instância "${inst.name}" está ativa em outro worker (${owner}). Roteie o request para ele.`,
      );
    }
    const provider = await this.spawn(inst);
    await provider.initialize();
    return provider;
  }

  /** Provider vivo obrigatório (para envio de mensagens). */
  async requireLive(instanceId: string): Promise<WhatsAppProvider> {
    return this.ensureConnected(instanceId);
  }

  private async spawn(inst: InstanceEntity): Promise<WhatsAppProvider> {
    const ctx = this.factory.buildContext(
      inst.id,
      inst.config,
      this.sessions,
      inst.identityMode as import('@wamux/shared').IdentityMode,
    );
    const provider = this.factory.create(inst.provider, ctx);
    this.wireEvents(provider);
    this.live.set(inst.id, provider);
    return provider;
  }

  /**
   * Entrega um evento a TODOS os transportes: webhook (fila BullMQ →
   * WebhookProcessor) e stream (WebSocket + RabbitMQ, via EventBus).
   */
  private fanOut(instanceId: string, event: WebhookEvent, payload: unknown): void {
    void this.webhooks.dispatch(instanceId, event, payload);
    void this.eventBus.emit(instanceId, event, payload);
  }

  /**
   * Pipeline de mensagem de ENTRADA: filtro de JID → fan-out. Ingestão de
   * mídia e dedup + log plugam aqui. Todo bloqueio é logado.
   */
  private async onInboundMessage(provider: WhatsAppProvider, m: NormalizedMessage): Promise<void> {
    // 1) dedup de entrada: drop só do par idêntico exato — sempre logado.
    const fresh = await this.dedup.firstSeen(m.instanceId, m.chatId, m.id, m.fromMe);
    if (!fresh) {
      this.logger.debug(
        `[${m.instanceId}] DROP duplicata (${m.chatId}/${m.id}/fromMe=${m.fromMe}) — já vista < 60s`,
      );
      return;
    }
    // 2) filtro de JID.
    if (!(await this.jidFilter.allows(m.instanceId, m.from, 'inbound'))) {
      this.logger.debug(`[${m.instanceId}] mensagem de ${m.from} bloqueada por filtro (inbound)`);
      return;
    }
    // 3) ingestão de mídia ANTES do fan-out: media.url pronto no webhook.
    await this.media.ingestInbound(provider, m);
    // 4) log de entrada + Inbox (opt-in, no-op se as flags estiverem off) + fan-out.
    void this.messageLog.recordInbound(m);
    void this.inboxStore.onInboundMessage(m);
    this.fanOut(m.instanceId, WebhookEvent.MESSAGE_RECEIVED, m);
  }

  // ── política de reconexão ─────────────────────────

  /** Classifica o statusCode bruto do Baileys (DisconnectReason). */
  private classifyDisconnect(statusCode?: number): 'terminal' | 'recoverable' {
    // 401 loggedOut · 403 forbidden (ban) · 440 connectionReplaced
    const terminal = new Set([401, 403, 440]);
    return statusCode != null && terminal.has(statusCode) ? 'terminal' : 'recoverable';
  }

  private clearReconnect(instanceId: string): void {
    const st = this.reconnect.get(instanceId);
    if (st?.timer) clearTimeout(st.timer);
    this.reconnect.delete(instanceId);
  }

  private scheduleReconnect(instanceId: string, statusCode?: number): void {
    if (this.classifyDisconnect(statusCode) === 'terminal') {
      this.logger.warn(`Desconexão terminal de ${instanceId} (statusCode=${statusCode})`);
      this.clearReconnect(instanceId);
      void this.instances.updateStatus(instanceId, ConnectionStatus.LOGGED_OUT, null);
      void this.destroyLive(instanceId);
      return;
    }

    const st = this.reconnect.get(instanceId) ?? { attempts: 0 };
    if (st.attempts >= this.maxReconnectAttempts) {
      this.logger.error(
        `Reconexão de ${instanceId} esgotada em ${st.attempts} tentativas (statusCode=${statusCode})`,
      );
      this.clearReconnect(instanceId);
      void this.instances.updateStatus(instanceId, ConnectionStatus.ERROR, null);
      this.fanOut(instanceId, WebhookEvent.CONNECTION_UPDATE, {
        instanceId,
        status: ConnectionStatus.ERROR,
        reason: 'reconnect_exhausted',
        statusCode,
      });
      return;
    }

    // backoff exponencial + jitter: min(base·2^n, max) + rand(0..1000)
    const backoff = Math.min(this.baseDelayMs * 2 ** st.attempts, this.maxDelayMs);
    const delay = backoff + Math.floor(Math.random() * 1_000);
    st.attempts += 1;
    st.timer = setTimeout(() => {
      const provider = this.live.get(instanceId);
      if (!provider) return; // foi liberado nesse meio-tempo
      provider
        .initialize()
        .catch((e) => this.logger.error(`reconnect ${instanceId}: ${(e as Error).message}`));
    }, delay);
    this.reconnect.set(instanceId, st);
    this.logger.log(`Reconexão de ${instanceId} agendada em ${delay}ms (tentativa ${st.attempts})`);
  }

  /** Pairing por telefone (código de 8 dígitos), quando a engine suporta. */
  async pairCode(instanceId: string, phone: string): Promise<{ code: string }> {
    const provider = await this.ensureConnected(instanceId);
    if (!provider.requestPairingCode) {
      throw new BadRequestException(`A engine "${provider.type}" não suporta pairing code.`);
    }
    return provider.requestPairingCode(phone);
  }

  /** Liga os eventos do provider aos transportes e à persistência de status. */
  private wireEvents(provider: WhatsAppProvider): void {
    provider.on('connection', (u: ConnectionUpdate) => {
      void this.instances.updateStatus(u.instanceId, u.status, u.wid ?? undefined);
      this.fanOut(u.instanceId, WebhookEvent.CONNECTION_UPDATE, u);
      if (u.qr) {
        this.fanOut(u.instanceId, WebhookEvent.QRCODE_UPDATED, {
          qr: u.qr,
          qrImage: u.qrImage,
          qrAttempts: u.qrAttempts,
          expiresAt: u.expiresAt,
        });
      }

      // Política central de reconexão: o adapter só reporta o motivo.
      switch (u.status) {
        case ConnectionStatus.CONNECTED:
          this.clearReconnect(u.instanceId); // sucesso → zera tentativas
          break;
        case ConnectionStatus.CONNECTING:
          if (u.reason === 'reconnecting') {
            this.scheduleReconnect(u.instanceId, u.statusCode);
            void this.reportRisk(u.instanceId, 'desconexão inesperada'); // sinal anti-ban
          }
          break;
        case ConnectionStatus.LOGGED_OUT:
          this.fanOut(u.instanceId, WebhookEvent.LOGOUT_INSTANCE, u);
          this.clearReconnect(u.instanceId);
          void this.destroyLive(u.instanceId);
          break;
        case ConnectionStatus.QR_EXPIRED:
          this.clearReconnect(u.instanceId); // parou de gerar QR; aguarda /connect
          break;
        default:
          break;
      }
    });

    provider.on('message', (m: NormalizedMessage) => {
      void this.onInboundMessage(provider, m);
    });

    provider.on('message.status', (s: MessageStatusUpdate) => {
      void this.messageLog.applyStatus(s); // persiste ack monotônico
      void this.inboxStore.onStatus(s); // propaga ack ao chat (opt-in)
      this.fanOut(s.instanceId, WebhookEvent.MESSAGE_STATUS, s);
    });

    // Cauda longa (chats, contatos, grupos, presença, chamada, etiquetas…):
    // o provider já resolve qual evento é; aqui só repassamos.
    provider.on('webhook', (w: WebhookPassthrough) => {
      void this.inboxStore.enrichFrom(w); // oportunista: contacts/chats.upsert (Baileys)
      this.fanOut(w.instanceId, w.event, w.payload);
    });

    // Voto de enquete: despacha E agrega no PollStore.
    provider.on('poll.vote', (v: PollVoteUpdate) => {
      this.fanOut(v.instanceId, WebhookEvent.POLL_VOTE, v);
      void this.pollStore.applyVote(v);
    });

    provider.on('error', (e) => {
      this.fanOut(e.instanceId, WebhookEvent.ERROR, { message: e.error.message });
      void this.reportRisk(e.instanceId, `error: ${e.error.message}`);
    });
  }

  async connect(instanceId: string): Promise<{ status: ConnectionStatus }> {
    const provider = await this.ensureConnected(instanceId);
    const st = provider.getStatus();
    // Reabre um QR expirado / erro terminal: força um novo ciclo.
    if (st === ConnectionStatus.QR_EXPIRED || st === ConnectionStatus.ERROR) {
      this.clearReconnect(instanceId);
      await provider.initialize(); // sock=undefined + destroyed resetado → regenera QR
    }
    return { status: provider.getStatus() };
  }

  async getQRCode(instanceId: string) {
    const provider = await this.ensureConnected(instanceId);
    return provider.getQRCode();
  }

  async logout(instanceId: string): Promise<void> {
    this.clearReconnect(instanceId);
    const provider = this.live.get(instanceId);
    if (provider) {
      await provider.logout();
      this.live.delete(instanceId);
    } else {
      await this.sessions.clear(instanceId);
    }
    await this.registry.release(instanceId);
    await this.instances.updateStatus(instanceId, ConnectionStatus.LOGGED_OUT, null);
  }

  /** Libera o provider vivo sem deslogar (usado ao remover/realocar). */
  async destroyLive(instanceId: string): Promise<void> {
    this.clearReconnect(instanceId);
    const provider = this.live.get(instanceId);
    if (provider) {
      await provider.destroy();
      this.live.delete(instanceId);
    }
    await this.registry.release(instanceId);
  }

  /**
   * Troca a engine da instância. Com `migrate=true` (e ambas as engines
   * suportando), exporta as credenciais do device da atual e importa na nova —
   * mantendo o WhatsApp linkado (sem QR). Senão, troca e repareia.
   *
   * ⚠️ Experimental: cross-lib (baileys↔whatsmeow) migra a identidade; as
   * sessões Signal re-sincronizam. Sempre sequencial (para → exporta → importa).
   */
  async changeProvider(
    instanceId: string,
    target: ProviderType,
    migrate: boolean,
  ): Promise<{ migrated: boolean; requiresQr: boolean; message: string }> {
    const inst = await this.instances.findOne(instanceId);
    if (inst.provider === target) {
      throw new BadRequestException(`A instância já usa a engine "${target}"`);
    }

    let portable: PortableCredentials | undefined;

    if (migrate) {
      const current = await this.ensureConnected(instanceId);
      if (!current.portableCredentials) {
        throw new BadRequestException(
          `A engine atual (${inst.provider}) não suporta migração de credenciais — use repareamento.`,
        );
      }
      try {
        portable = await current.exportCredentials();
      } catch (e) {
        throw new BadRequestException(
          `Falha ao exportar credenciais de ${inst.provider}: ${(e as Error).message}`,
        );
      }
    }

    // Para a engine atual (sem deslogar) e troca no registro.
    await this.destroyLive(instanceId);
    await this.instances.updateProvider(instanceId, target);
    const updated = await this.instances.findOne(instanceId);

    if (migrate && portable) {
      const next = await this.spawn(updated);
      if (!next.portableCredentials) {
        await this.destroyLive(instanceId);
        throw new BadRequestException(`A engine "${target}" não suporta importar credenciais.`);
      }
      if (!(await this.registry.claim(instanceId))) {
        throw new ConflictException('Instância ativa em outro worker.');
      }
      try {
        await next.importCredentials(portable);
        await next.initialize();
      } catch (e) {
        // Rollback: volta pro provider original SEM limpar a sessão dele (as
        // credenciais do Baileys ficam intactas — nada de perder o pareamento).
        await this.destroyLive(instanceId);
        await this.instances.updateProvider(instanceId, inst.provider);
        // Reconecta a engine original (creds preservadas) para não deixar a
        // instância caída depois de uma migração malsucedida.
        try {
          await this.ensureConnected(instanceId);
        } catch (re) {
          this.logger.warn(
            `Reconexão pós-rollback de ${inst.provider} falhou: ${(re as Error).message}`,
          );
        }
        this.logger.warn(
          `Migração ${inst.provider} → ${target} falhou; revertido para ${inst.provider}`,
        );
        throw new BadRequestException(
          `Falha ao importar credenciais em ${target} (revertido para ${inst.provider}, sessão preservada): ${(e as Error).message}`,
        );
      }
      this.logger.log(`Migração ${inst.provider} → ${target} em "${updated.name}" (sem reparear)`);
      return {
        migrated: true,
        requiresQr: false,
        message: 'Migrado sem reparear — identidade do device preservada.',
      };
    }

    // Repareamento: limpa a sessão; a próxima conexão gera QR.
    await this.sessions.clear(instanceId);
    await this.instances.updateStatus(instanceId, ConnectionStatus.DISCONNECTED, null);
    this.logger.log(`Troca ${inst.provider} → ${target} em "${updated.name}" (reparear)`);
    return {
      migrated: false,
      requiresQr: true,
      message: 'Engine trocada. Conecte a instância e escaneie o QR.',
    };
  }
}
