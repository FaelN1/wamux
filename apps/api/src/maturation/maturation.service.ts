import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { InjectRepository } from '@nestjs/typeorm';
import { Queue } from 'bullmq';
import { Repository } from 'typeorm';
import {
  DEFAULT_MATURATION_SCRIPT,
  MATURATION_LOCATIONS,
  MEDIA_CAPTIONS,
  MaturationConfig,
  MaturationEventEntry,
  MaturationPlanDTO,
  POLL_TOPICS,
  maturationTargetForDay,
  zMaturationConfig,
} from '@wamux/shared';
import { ConnectionStatus, ProviderType } from '../providers/provider.types';
import { InstanceEntity } from '../instance/instance.entity';
import { InstanceService } from '../instance/instance.service';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { MessagingService, SendOutcome } from '../messaging/messaging.service';
import { MaturationPlanEntity } from './maturation-plan.entity';
import { MaturationMediaService } from './maturation-media.service';
import { MATURATION_QUEUE, MaturationAckJob, MaturationJob } from './maturation.constants';
import { CreateMaturationPlanDto } from './dto/create-maturation-plan.dto';
import { UpdateMaturationPlanDto } from './dto/update-maturation-plan.dto';

/** Tamanho do feed "ao vivo" persistido por plano (mais recentes primeiro). */
const EVENT_BUFFER = 60;
/** Eventos informativos repetidos dentro desta janela não re-entram no feed. */
const EVENT_THROTTLE_MS = 10 * 60_000;

/** Resultado de um envio de turno: o outcome da fachada + o rótulo do feed. */
interface TurnSend {
  outcome: SendOutcome;
  label: string;
}

/**
 * Painel de maturação (aquecimento de chip): orquestra conversas entre as
 * instâncias de um plano ao longo de uma rampa de dias, com padrão humano —
 * janela de horário, delays com jitter, "digitando…", leitura e reações.
 *
 * A execução é uma CADEIA de jobs BullMQ (`turn`): cada turno envia UMA
 * mensagem de um lado do par e agenda o próximo turno. Como o próximo só é
 * agendado quando o atual termina, os contadores do plano são escritos de
 * forma serial (o job `ack`, do lado receptor, apenas anexa eventos ao feed).
 *
 * O envio em si passa pela fachada normal (`MessagingService`), então
 * rate-limit anti-ban, idempotência, log e Inbox continuam valendo.
 */
@Injectable()
export class MaturationService implements OnModuleInit {
  private readonly logger = new Logger(MaturationService.name);

  constructor(
    @InjectRepository(MaturationPlanEntity)
    private readonly repo: Repository<MaturationPlanEntity>,
    private readonly instances: InstanceService,
    private readonly manager: InstanceManagerService,
    private readonly messaging: MessagingService,
    private readonly media: MaturationMediaService,
    @InjectQueue(MATURATION_QUEUE) private readonly queue: Queue<MaturationJob>,
  ) {}

  /** Boot: planos `running` sem turno agendado (worker morreu) são retomados. */
  async onModuleInit(): Promise<void> {
    try {
      const running = await this.repo.find({ where: { status: 'running' } });
      if (!running.length) return;
      const jobs = await this.queue.getJobs(['delayed', 'waiting', 'active', 'paused']);
      const scheduled = new Set(
        jobs.filter((j) => j?.name === 'turn').map((j) => (j.data as { planId: string }).planId),
      );
      for (const plan of running) {
        if (scheduled.has(plan.id)) continue;
        this.logger.log(`Plano "${plan.name}" rodava sem turno agendado — retomando.`);
        await this.scheduleTurn(plan, this.rand(5_000, 30_000));
      }
    } catch (err) {
      this.logger.error(`Falha ao retomar planos de maturação: ${(err as Error).message}`);
    }
  }

  // ── CRUD ──────────────────────────────────────────────────────────

  async list(): Promise<MaturationPlanDTO[]> {
    const [plans, byId] = await Promise.all([
      this.repo.find({ order: { createdAt: 'DESC' } }),
      this.instanceMap(),
    ]);
    return plans.map((p) => this.toDTO(p, byId));
  }

  async get(id: string): Promise<MaturationPlanDTO> {
    const plan = await this.findEntity(id);
    return this.toDTO(plan, await this.instanceMap());
  }

  async create(dto: CreateMaturationPlanDto): Promise<MaturationPlanDTO> {
    const existing = await this.repo.findOne({ where: { name: dto.name } });
    if (existing) throw new ConflictException(`Já existe plano com o nome "${dto.name}"`);
    const config = this.parseConfig(dto.config);
    const byId = await this.instanceMap();
    this.validateInstances(dto.instanceIds, byId);
    const plan = this.repo.create({
      name: dto.name,
      status: 'draft',
      instanceIds: dto.instanceIds,
      config,
      progress: {},
    });
    return this.toDTO(await this.repo.save(plan), byId);
  }

  async update(id: string, dto: UpdateMaturationPlanDto): Promise<MaturationPlanDTO> {
    const plan = await this.findEntity(id);
    if (plan.status === 'running') {
      throw new ConflictException('Pause o plano antes de editar.');
    }
    if (dto.name && dto.name !== plan.name) {
      const clash = await this.repo.findOne({ where: { name: dto.name } });
      if (clash) throw new ConflictException(`Já existe plano com o nome "${dto.name}"`);
      plan.name = dto.name;
    }
    const byId = await this.instanceMap();
    if (dto.instanceIds) {
      this.validateInstances(dto.instanceIds, byId);
      plan.instanceIds = dto.instanceIds;
    }
    if (dto.config) plan.config = this.parseConfig(dto.config);
    return this.toDTO(await this.repo.save(plan), byId);
  }

  async remove(id: string): Promise<void> {
    const plan = await this.findEntity(id);
    await this.removePendingJobs(plan.id);
    await this.repo.remove(plan);
  }

  // ── ciclo de vida ─────────────────────────────────────────────────

  /** Inicia (draft), retoma (paused) ou reinicia a rampa (completed). */
  async start(id: string): Promise<MaturationPlanDTO> {
    const plan = await this.findEntity(id);
    const byId = await this.instanceMap();
    if (plan.status === 'running') return this.toDTO(plan, byId);

    this.validateInstances(plan.instanceIds, byId);

    // Uma instância só matura em UM plano por vez — padrão regular demais
    // se o mesmo número participa de dois roteiros simultâneos.
    const others = await this.repo.find({ where: { status: 'running' } });
    const used = new Set(others.filter((p) => p.id !== plan.id).flatMap((p) => p.instanceIds));
    const overlap = plan.instanceIds.filter((iid) => used.has(iid));
    if (overlap.length) {
      const names = overlap.map((iid) => byId.get(iid)?.name ?? iid).join(', ');
      throw new ConflictException(`Número(s) já em maturação em outro plano: ${names}`);
    }

    if (plan.status === 'paused' && plan.pausedAt && plan.startedAt) {
      // desloca a âncora pelo tempo pausado — o dia da rampa "congela".
      plan.startedAt = new Date(plan.startedAt.getTime() + (Date.now() - plan.pausedAt.getTime()));
      this.pushEvent(plan, { kind: 'info', text: 'Plano retomado.' });
    } else {
      plan.startedAt = new Date();
      plan.progress.conversation = undefined;
      this.pushEvent(plan, {
        kind: 'info',
        text: `Plano iniciado — rampa de ${plan.config.durationDays} dias.`,
      });
    }
    plan.pausedAt = null;
    plan.status = 'running';
    await this.scheduleTurn(plan, this.rand(3_000, 10_000));
    return this.toDTO(plan, byId);
  }

  async pause(id: string): Promise<MaturationPlanDTO> {
    const plan = await this.findEntity(id);
    if (plan.status !== 'running') {
      throw new ConflictException('Só é possível pausar um plano rodando.');
    }
    plan.status = 'paused';
    plan.pausedAt = new Date();
    plan.progress.nextTurnAt = null;
    this.pushEvent(plan, { kind: 'info', text: 'Plano pausado.' });
    await this.repo.save(plan);
    await this.removePendingJobs(plan.id);
    return this.toDTO(plan, await this.instanceMap());
  }

  // ── motor: um turno de conversa ───────────────────────────────────

  /**
   * Executa UM turno: escolhe/continua o par, simula digitação, envia e
   * agenda o próximo. NUNCA lança — erro vira evento no feed e a cadeia
   * continua (senão um erro transitório mataria o plano em silêncio).
   */
  async runTurn(planId: string): Promise<void> {
    const plan = await this.repo.findOne({ where: { id: planId } });
    if (!plan || plan.status !== 'running') return;
    const cfg = plan.config;

    try {
      // 1) rampa concluída?
      const day = this.dayIndex(plan);
      if (day >= cfg.durationDays) {
        plan.status = 'completed';
        plan.progress.nextTurnAt = null;
        this.pushEvent(plan, {
          kind: 'info',
          text: `Rampa de ${cfg.durationDays} dias concluída 🎉 Número(s) maturado(s).`,
        });
        await this.repo.save(plan);
        return;
      }

      // 2) fora da janela ativa → dorme até a próxima abertura (com jitter).
      const hour = this.cfgHour(cfg);
      if (hour < cfg.activeHours.start || hour >= cfg.activeHours.end) {
        this.pushEvent(
          plan,
          { kind: 'info', text: 'Fora da janela ativa — retomo na próxima abertura.' },
          true,
        );
        await this.scheduleTurn(plan, this.msUntilWindowStart(cfg) + this.rand(0, 15 * 60_000));
        return;
      }

      // 3) elegíveis agora: conectadas e com número conhecido.
      const byId = await this.instanceMap();
      const pool = plan.instanceIds
        .map((iid) => byId.get(iid))
        .filter((i): i is InstanceEntity => !!i);
      const eligible = pool.filter((i) => i.status === ConnectionStatus.CONNECTED && i.wid);
      if (eligible.length < 2) {
        this.pushEvent(
          plan,
          {
            kind: 'skip',
            text: `Aguardando ≥ 2 números conectados (${eligible.length}/${pool.length}). Conecte-os na tela de Instâncias.`,
          },
          true,
        );
        await this.scheduleTurn(plan, this.rand(60_000, 180_000));
        return;
      }

      // 4) metas do dia.
      const target = maturationTargetForDay(cfg, day);
      const dayKey = this.dayKey(cfg);
      const sentOf = (iid: string): number =>
        plan.progress.perInstance?.[iid]?.byDay?.[dayKey] ?? 0;
      const behind = eligible.filter((i) => sentOf(i.id) < target);
      if (!behind.length) {
        this.pushEvent(
          plan,
          {
            kind: 'info',
            text: `Meta do dia ${day + 1}/${cfg.durationDays} atingida (${target} msgs/número). Até a próxima janela 👋`,
          },
          true,
        );
        await this.scheduleTurn(plan, this.msUntilWindowStart(cfg) + this.rand(0, 20 * 60_000));
        return;
      }

      // 5) par + turno: continua a conversa corrente ou abre uma nova.
      const eligibleIds = new Set(eligible.map((i) => i.id));
      let convo = plan.progress.conversation;
      let sender: InstanceEntity | undefined;
      let receiver: InstanceEntity | undefined;

      if (
        convo &&
        convo.remainingTurns > 0 &&
        eligibleIds.has(convo.a) &&
        eligibleIds.has(convo.b)
      ) {
        const nextId = convo.lastFrom === convo.a ? convo.b : convo.a;
        const otherId = nextId === convo.a ? convo.b : convo.a;
        // quem responderia já bateu a meta? inverte; ambos bateram? encerra.
        const pickId =
          sentOf(nextId) < target ? nextId : sentOf(otherId) < target ? otherId : undefined;
        if (pickId) {
          sender = byId.get(pickId);
          receiver = byId.get(pickId === convo.a ? convo.b : convo.a);
        } else {
          convo = plan.progress.conversation = undefined;
        }
      } else {
        convo = plan.progress.conversation = undefined;
      }

      if (!sender || !receiver || !convo) {
        // nova conversa: remetente = maior déficit; receptor prefere atrasados.
        const sorted = [...behind].sort(
          (x, y) => sentOf(x.id) - sentOf(y.id) || Math.random() - 0.5,
        );
        sender = sorted[0];
        const others = eligible.filter((i) => i.id !== sorted[0].id);
        const behindOthers = others.filter((i) => sentOf(i.id) < target);
        receiver = this.pick(behindOthers.length ? behindOthers : others);
        convo = plan.progress.conversation = {
          a: sender.id,
          b: receiver.id,
          remainingTurns: this.rand(3, 8),
          opened: false,
        };
      }

      // 6) compõe e envia a mensagem do turno — texto, mídia (Pexels),
      //    enquete ou localização, com fallback pra texto se o tipo especial
      //    não for suportado pela engine.
      const jid = this.widToJid(receiver.wid as string);
      const sent = await this.composeAndSend(plan, sender.id, jid, convo);

      // 7) contadores + estado da conversa.
      const per = (plan.progress.perInstance ??= {});
      const mine = (per[sender.id] ??= { totalSent: 0, byDay: {} });
      mine.totalSent += 1;
      mine.byDay[dayKey] = (mine.byDay[dayKey] ?? 0) + 1;
      convo.remainingTurns -= 1;
      convo.lastFrom = sender.id;
      if (convo.remainingTurns <= 0) plan.progress.conversation = undefined;
      this.pushEvent(plan, {
        kind: 'sent',
        from: sender.name,
        to: receiver.name,
        text: sent.label.length > 80 ? `${sent.label.slice(0, 77)}…` : sent.label,
      });

      // 8) lado receptor: leitura + reação, alguns segundos depois.
      const outcome = sent.outcome;
      if (outcome.id && (cfg.markAsRead || cfg.reactionChance > 0)) {
        await this.queue.add(
          'ack',
          {
            planId: plan.id,
            receiverId: receiver.id,
            chatJid: this.widToJid(sender.wid as string),
            messageId: outcome.id,
            fromName: sender.name,
            toName: receiver.name,
          },
          {
            delay: this.rand(2_500, 20_000),
            attempts: 1,
            removeOnComplete: true,
            removeOnFail: true,
          },
        );
      }

      // 10) próximo turno: jitter, esticado pelo "gap ideal" para espalhar a
      // meta restante pela janela (terminar tudo cedo demais também é padrão).
      const remaining = behind.reduce((acc, i) => acc + Math.max(0, target - sentOf(i.id)), 0);
      const hoursLeft = Math.max(cfg.activeHours.end - this.cfgHour(cfg), 0.05);
      const idealGapSec = (hoursLeft * 3_600) / Math.max(remaining, 1);
      let delaySec = this.rand(cfg.minDelaySec, cfg.maxDelaySec);
      if (idealGapSec > delaySec) delaySec = Math.round(idealGapSec * (0.7 + Math.random() * 0.6));
      await this.scheduleTurn(plan, delaySec * 1_000);
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      this.logger.warn(`[maturação:${plan.name}] turno falhou: ${msg}`);
      this.pushEvent(plan, { kind: 'error', text: `Turno falhou: ${msg}` });
      await this.scheduleTurn(plan, this.rand(cfg.minDelaySec, cfg.maxDelaySec) * 1_000);
    }
  }

  /**
   * Decide o conteúdo do turno e envia pela fachada normal. Abertura/fecho são
   * sempre texto; no meio da conversa rola mídia (Pexels) / enquete /
   * localização conforme as chances do plano, sempre com fallback pra texto se
   * o tipo especial não for suportado pela engine (501/422) ou a mídia falhar.
   */
  private async composeAndSend(
    plan: MaturationPlanEntity,
    senderId: string,
    jid: string,
    convo: NonNullable<MaturationPlanEntity['progress']['conversation']>,
  ): Promise<TurnSend> {
    const cfg = plan.config;
    const script = DEFAULT_MATURATION_SCRIPT;

    // abertura / fechamento definem o tom → sempre texto.
    if (!convo.opened) {
      convo.opened = true;
      return this.sendTextTurn(cfg, senderId, jid, this.pick(script.openers));
    }
    if (convo.remainingTurns <= 1) {
      return this.sendTextTurn(cfg, senderId, jid, this.pick(script.closers));
    }

    // meio da conversa: rola conteúdo especial (rolls independentes, chances
    // pequenas). Cada tentativa degrada pra texto se a engine não entregar.
    // Defaults defensivos: planos criados antes destes campos existirem têm
    // `mediaTypes`/`*Chance` ausentes no jsonb — tratamos como 0/[].
    const mediaTypes = cfg.mediaTypes ?? [];
    if (this.media.enabled && mediaTypes.length && Math.random() < (cfg.mediaChance ?? 0)) {
      const special = await this.trySendMedia(senderId, jid, mediaTypes);
      if (special) return special;
    }
    if (Math.random() < (cfg.pollChance ?? 0)) {
      const topic = this.pick(POLL_TOPICS);
      const special = await this.attempt(
        () => this.messaging.sendPoll(senderId, { to: jid, ...topic }),
        `📊 ${topic.question}`,
      );
      if (special) return special;
    }
    if (Math.random() < (cfg.locationChance ?? 0)) {
      const loc = this.pick(MATURATION_LOCATIONS);
      const special = await this.attempt(
        () => this.messaging.sendLocation(senderId, { to: jid, ...loc }),
        `📍 ${loc.name}`,
      );
      if (special) return special;
    }

    // texto normal: resposta ou emoji solto.
    const text =
      Math.random() < 0.12
        ? this.pick(script.emojis)
        : this.pick([...script.replies, ...(cfg.phrases ?? [])]);
    return this.sendTextTurn(cfg, senderId, jid, text);
  }

  /** Texto: "digitando…" (opcional) + envio. */
  private async sendTextTurn(
    cfg: MaturationConfig,
    senderId: string,
    jid: string,
    text: string,
  ): Promise<TurnSend> {
    if (cfg.simulateTyping) await this.simulateTyping(senderId, jid, text);
    // Sem `clientMessageId`: aquecimento não precisa de idempotência e o
    // idemKey derivado (`instanceId:clientMessageId`) viraria um jobId com
    // ":" — que o BullMQ rejeita ("Custom Id cannot contain :").
    const outcome = await this.messaging.sendText(senderId, { to: jid, text });
    return { outcome, label: text };
  }

  /** Busca uma mídia no Pexels e envia por URL; `null` se indisponível. */
  private async trySendMedia(
    senderId: string,
    jid: string,
    types: MaturationConfig['mediaTypes'],
  ): Promise<TurnSend | null> {
    const media = await this.media.random(this.pick(types));
    if (!media) return null;
    const caption = this.pick(MEDIA_CAPTIONS);
    const icon = media.type === 'image' ? '📷 foto' : '🎬 vídeo';
    return this.attempt(
      () =>
        this.messaging.sendMedia(senderId, {
          to: jid,
          type: media.type,
          url: media.url,
          mimetype: media.mimetype,
          caption: caption || undefined,
        }),
      caption ? `${icon} — ${caption}` : icon,
    );
  }

  /** Envolve um envio especial: sucesso → {outcome,label}; erro → null (cai pra texto). */
  private async attempt(fn: () => Promise<SendOutcome>, label: string): Promise<TurnSend | null> {
    try {
      return { outcome: await fn(), label };
    } catch (err) {
      this.logger.debug(`maturação: tipo especial indisponível (${(err as Error).message})`);
      return null;
    }
  }

  /** Lado receptor: marca como lida e, com sorte, reage — nunca lança. */
  async runAck(job: MaturationAckJob): Promise<void> {
    const plan = await this.repo.findOne({ where: { id: job.planId } });
    if (!plan || plan.status !== 'running') return;
    const cfg = plan.config;
    let touched = false;
    try {
      const provider = await this.manager.requireLive(job.receiverId);
      if (cfg.markAsRead && provider.capabilities.markRead && provider.markRead) {
        await provider.markRead(job.chatJid, [job.messageId]);
        this.pushEvent(plan, {
          kind: 'read',
          from: job.toName,
          text: `leu a conversa com ${job.fromName}`,
        });
        touched = true;
      }
      if (
        Math.random() < cfg.reactionChance &&
        provider.capabilities.reactions &&
        provider.reactMessage
      ) {
        const emoji = this.pick(DEFAULT_MATURATION_SCRIPT.reactions);
        await provider.reactMessage({
          chatId: job.chatJid,
          messageId: job.messageId,
          emoji,
          fromMe: false,
        });
        this.pushEvent(plan, {
          kind: 'reaction',
          from: job.toName,
          text: `reagiu ${emoji} à mensagem de ${job.fromName}`,
        });
        touched = true;
      }
    } catch (err) {
      this.logger.debug(`[maturação:${plan.name}] ack falhou: ${(err as Error).message}`);
    }
    if (touched) await this.repo.save(plan);
  }

  // ── helpers ───────────────────────────────────────────────────────

  private async findEntity(id: string): Promise<MaturationPlanEntity> {
    const plan = await this.repo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException(`Plano de maturação ${id} não encontrado`);
    return plan;
  }

  private async instanceMap(): Promise<Map<string, InstanceEntity>> {
    return new Map((await this.instances.findAll()).map((i) => [i.id, i]));
  }

  private parseConfig(raw: Record<string, unknown>): MaturationConfig {
    const parsed = zMaturationConfig.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `config${i.path.length ? `.${i.path.join('.')}` : ''}: ${i.message}`)
        .join('; ');
      throw new BadRequestException(issues);
    }
    return parsed.data;
  }

  /** Instâncias devem existir e não podem ser Cloud API (número oficial não matura). */
  private validateInstances(ids: string[], byId: Map<string, InstanceEntity>): void {
    for (const id of ids) {
      const inst = byId.get(id);
      if (!inst) throw new BadRequestException(`Instância ${id} não existe`);
      if (inst.provider === ProviderType.CLOUD_API) {
        throw new BadRequestException(
          `"${inst.name}" usa a Cloud API oficial — números oficiais não precisam (nem podem) ser maturados. Use instâncias baileys/webjs/whatsmeow.`,
        );
      }
    }
  }

  /**
   * Agenda o próximo turno e registra `nextTurnAt` para o countdown do painel.
   * Sem `jobId` customizado de propósito: o BullMQ gera um id único sozinho, e
   * ids com ":" são rejeitados ("Custom Id cannot contain :"). A cadeia é
   * serial (cada turno agenda o próximo), então não há o que deduplicar aqui.
   */
  private async scheduleTurn(plan: MaturationPlanEntity, delayMs: number): Promise<void> {
    plan.progress.nextTurnAt = Date.now() + delayMs;
    await this.repo.save(plan);
    await this.queue.add(
      'turn',
      { planId: plan.id },
      { delay: delayMs, attempts: 1, removeOnComplete: true, removeOnFail: true },
    );
  }

  private async removePendingJobs(planId: string): Promise<void> {
    const jobs = await this.queue.getJobs(['delayed', 'waiting']);
    for (const j of jobs) {
      if (j && (j.data as { planId?: string }).planId === planId) {
        await j.remove().catch(() => undefined);
      }
    }
  }

  /** "Digitando…" proporcional ao texto — cosmético: nunca derruba o turno. */
  private async simulateTyping(instanceId: string, to: string, text: string): Promise<void> {
    try {
      const p = await this.manager.requireLive(instanceId);
      if (!p.capabilities.presence || !p.setPresence) return;
      const durationMs = Math.min(1_200 + text.length * 65, 6_000);
      await p.setPresence({ to, state: 'composing', durationMs });
      await this.sleep(durationMs);
      await p.setPresence({ to, state: 'paused' });
    } catch {
      /* presença é opcional por engine */
    }
  }

  /** Dia da rampa (0-based); congela durante a pausa. */
  private dayIndex(plan: MaturationPlanEntity): number {
    if (!plan.startedAt) return 0;
    const anchor = new Date(plan.startedAt).getTime();
    const ref =
      plan.status === 'paused' && plan.pausedAt ? new Date(plan.pausedAt).getTime() : Date.now();
    return Math.max(0, Math.floor((ref - anchor) / 86_400_000));
  }

  /** Hora (fracionária) no fuso do plano — default: fuso local do servidor. */
  private cfgHour(cfg: MaturationConfig): number {
    const now = new Date();
    if (cfg.utcOffsetHours == null) return now.getHours() + now.getMinutes() / 60;
    const h = now.getUTCHours() + now.getUTCMinutes() / 60 + cfg.utcOffsetHours;
    return ((h % 24) + 24) % 24;
  }

  /** Chave YYYY-MM-DD dos contadores diários, no fuso do plano. */
  private dayKey(cfg: MaturationConfig): string {
    const offsetH = cfg.utcOffsetHours ?? -new Date().getTimezoneOffset() / 60;
    return new Date(Date.now() + offsetH * 3_600_000).toISOString().slice(0, 10);
  }

  /** ms até a próxima abertura da janela ativa (hoje ou amanhã). */
  private msUntilWindowStart(cfg: MaturationConfig): number {
    let diff = cfg.activeHours.start - this.cfgHour(cfg);
    if (diff <= 0) diff += 24;
    return Math.round(diff * 3_600_000);
  }

  /**
   * Anexa um evento ao feed (ring buffer). Com `throttle`, o mesmo evento
   * repetido dentro da janela não re-entra (evita spam de "fora da janela").
   */
  private pushEvent(
    plan: MaturationPlanEntity,
    evt: Omit<MaturationEventEntry, 'ts'>,
    throttle = false,
  ): void {
    const events = (plan.progress.events ??= []);
    if (throttle) {
      const last = events.find((e) => e.kind === evt.kind);
      if (last && last.text === evt.text && Date.now() - last.ts < EVENT_THROTTLE_MS) return;
    }
    events.unshift({ ts: Date.now(), ...evt });
    if (events.length > EVENT_BUFFER) events.length = EVENT_BUFFER;
  }

  /** `wid` (ex.: `5511…:12@s.whatsapp.net`) → jid endereçável sem device. */
  private widToJid(wid: string): string {
    const [user, server = 's.whatsapp.net'] = wid.split('@');
    return `${user.split(':')[0]}@${server}`;
  }

  private toDTO(plan: MaturationPlanEntity, byId: Map<string, InstanceEntity>): MaturationPlanDTO {
    const cfg = plan.config;
    const rawDay = plan.startedAt ? this.dayIndex(plan) : 0;
    const targetToday = maturationTargetForDay(cfg, Math.min(rawDay, cfg.durationDays - 1));
    const dayKey = this.dayKey(cfg);
    const per = plan.progress.perInstance ?? {};
    const instances = plan.instanceIds.map((iid) => {
      const inst = byId.get(iid);
      const p = per[iid];
      return {
        instanceId: iid,
        name: inst?.name ?? '(instância removida)',
        provider: (inst?.provider ?? ProviderType.BAILEYS) as ProviderType,
        connectionStatus: inst?.status ?? ConnectionStatus.DISCONNECTED,
        wid: inst?.wid ?? null,
        sentToday: p?.byDay?.[dayKey] ?? 0,
        targetToday,
        totalSent: p?.totalSent ?? 0,
      };
    });
    return {
      id: plan.id,
      name: plan.name,
      status: plan.status,
      config: cfg,
      instanceIds: plan.instanceIds,
      createdAt: plan.createdAt.toISOString(),
      startedAt: plan.startedAt ? new Date(plan.startedAt).toISOString() : null,
      dayIndex: Math.min(rawDay, cfg.durationDays),
      nextTurnAt: plan.progress.nextTurnAt ?? null,
      totalSent: instances.reduce((acc, i) => acc + i.totalSent, 0),
      instances,
      events: plan.progress.events ?? [],
    };
  }

  private rand(min: number, max: number): number {
    return Math.floor(min + Math.random() * (max - min + 1));
  }

  private pick<T>(arr: T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
