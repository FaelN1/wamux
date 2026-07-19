import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { RateLimiterService } from '../throttle/rate-limiter.service';
import { IdempotencyService } from '../throttle/idempotency.service';
import { SettingsService } from '../settings/settings.service';
import {
  ProviderCapabilities,
  PollResults,
  ReactMessageInput,
  EditMessageInput,
  DeleteMessageInput,
  SendButtonsInput,
  SendContactInput,
  SendListInput,
  SendLocationInput,
  SendMediaInput,
  SendPixInput,
  SendPollInput,
  SendResult,
  SendStatusInput,
  SendTextInput,
} from '../providers/provider.types';
import { WhatsAppProvider } from '../providers/provider.interface';
import { ReactMessageDto } from './dto/react-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { SendLocationDto } from './dto/send-location.dto';
import { SendContactDto } from './dto/send-contact.dto';
import { SendStatusDto } from './dto/send-status.dto';
import { RequestLocationDto } from './dto/request-location.dto';
import { OUTBOUND_QUEUE, OutboundJob, OutboundKind, OutboundPayload } from './outbound.constants';
import { PollStore } from './poll-store.service';
import { MessageLogService } from './message-log.service';
import { InboxStoreService } from '../inbox/inbox-store.service';
import { MessageLogEntity } from './message-log.entity';
import { JidFilterService } from '../common/jid-filter.service';
import { MediaService } from '../media/media.service';
import { SendMediaDto } from './dto/send-media.dto';
import { SendTextDto } from './dto/send-text.dto';
import { SendPollDto } from './dto/send-poll.dto';
import { SendButtonsDto } from './dto/send-buttons.dto';
import { SendListDto } from './dto/send-list.dto';
import { SendPixDto } from './dto/send-pix.dto';

/** Resultado de um envio: imediato, enfileirado (throttle) ou duplicado. */
export interface SendOutcome {
  id?: string;
  to?: string;
  timestamp?: number;
  status: 'sent' | 'queued' | 'in_progress';
  queued?: boolean;
  duplicate?: boolean;
  jobId?: string;
}

/**
 * Fachada de envio com controle de ritmo (anti-ban) e idempotência:
 *  1. idempotência: `clientMessageId` repetido não reenvia.
 *  2. rate limit por instância (token bucket): se houver token, envia na hora.
 *  3. estouro do limite: enfileira em `messages-out`, onde o worker faz o
 *     pacing e envia quando um token liberar.
 */
@Injectable()
export class MessagingService {
  constructor(
    private readonly manager: InstanceManagerService,
    private readonly limiter: RateLimiterService,
    private readonly idem: IdempotencyService,
    private readonly settings: SettingsService,
    private readonly polls: PollStore,
    private readonly jidFilter: JidFilterService,
    private readonly messageLog: MessageLogService,
    private readonly inboxStore: InboxStoreService,
    private readonly media: MediaService,
    @InjectQueue(OUTBOUND_QUEUE) private readonly queue: Queue<OutboundJob>,
  ) {}

  /** Status de entrega de uma mensagem enviada. 404 se não existir. */
  async messageStatus(instanceId: string, messageId: string): Promise<MessageLogEntity> {
    const log = await this.messageLog.get(instanceId, messageId);
    if (!log) throw new NotFoundException(`Mensagem ${messageId} não encontrada`);
    return log;
  }

  sendText(instanceId: string, dto: SendTextDto): Promise<SendOutcome> {
    const payload: SendTextInput = {
      to: dto.to,
      text: dto.text,
      quotedMessageId: dto.quotedMessageId,
      linkPreview: dto.linkPreview,
    };
    return this.dispatch(instanceId, 'text', payload, dto.clientMessageId);
  }

  /**
   * `MediaService.prepareOutbound` (pré-existente, mas nunca chamado daqui
   * — o próprio comentário do `MediaModule` já dizia "MessagingService
   * (saída) injeta o MediaService", só a ligação nunca tinha sido feita)
   * sobe `base64` pro nosso store e devolve uma URL servível ANTES de
   * mandar — sem isso, mídia enviada via base64 nunca tinha URL própria
   * pra persistir/re-exibir depois na thread do Inbox (só existia dentro
   * do protocolo do WhatsApp, inacessível pra nós depois do envio).
   */
  async sendMedia(instanceId: string, dto: SendMediaDto): Promise<SendOutcome> {
    if (!dto.url && !dto.base64) {
      throw new BadRequestException('Informe "url" ou "base64" da mídia');
    }
    const source = await this.media.prepareOutbound(instanceId, dto);
    const payload: SendMediaInput = {
      to: dto.to,
      type: dto.type,
      url: source.url ?? dto.url,
      base64: source.url ? undefined : dto.base64,
      caption: dto.caption,
      filename: dto.filename,
      mimetype: dto.mimetype,
      quotedMessageId: dto.quotedMessageId,
      asGif: dto.asGif,
      asPtt: dto.asPtt,
      asPtv: dto.asPtv,
      animated: dto.animated,
    };
    return this.dispatch(instanceId, 'media', payload, dto.clientMessageId);
  }

  // ── interativos ──────────────────────────────────

  async sendPoll(instanceId: string, dto: SendPollDto): Promise<SendOutcome> {
    await this.requireCapability(instanceId, 'poll');
    const payload: SendPollInput = {
      to: dto.to,
      question: dto.question,
      options: dto.options,
      selectableCount: dto.selectableCount ?? 1,
    };
    const outcome = await this.dispatch(instanceId, 'poll', payload, dto.clientMessageId);
    // Registra a enquete p/ agregação (pergunta+opções) quando temos o id.
    if (outcome.id) await this.polls.register(instanceId, outcome.id, dto.question, dto.options);
    return outcome;
  }

  async sendButtons(instanceId: string, dto: SendButtonsDto): Promise<SendOutcome> {
    const payload: SendButtonsInput = {
      to: dto.to,
      text: dto.text,
      footer: dto.footer,
      buttons: dto.buttons,
      fallbackToText: dto.fallbackToText,
    };
    const kind = await this.resolveInteractive(instanceId, 'buttons', payload);
    return this.dispatch(instanceId, kind, this.maybeText(kind, payload), dto.clientMessageId);
  }

  async sendList(instanceId: string, dto: SendListDto): Promise<SendOutcome> {
    const payload: SendListInput = {
      to: dto.to,
      text: dto.text,
      buttonText: dto.buttonText,
      sections: dto.sections,
      title: dto.title,
      footer: dto.footer,
      fallbackToText: dto.fallbackToText,
    };
    const kind = await this.resolveInteractive(instanceId, 'list', payload);
    return this.dispatch(instanceId, kind, this.maybeText(kind, payload), dto.clientMessageId);
  }

  async sendPix(instanceId: string, dto: SendPixDto): Promise<SendOutcome> {
    const payload: SendPixInput = { to: dto.to, pix: dto.pix, fallbackToText: dto.fallbackToText };
    const kind = await this.resolveInteractive(instanceId, 'pix', payload);
    return this.dispatch(instanceId, kind, this.maybeText(kind, payload), dto.clientMessageId);
  }

  async sendLocation(instanceId: string, dto: SendLocationDto): Promise<SendOutcome> {
    await this.cap(instanceId, 'location', (x) => x.sendLocation);
    const payload: SendLocationInput = {
      to: dto.to,
      latitude: dto.latitude,
      longitude: dto.longitude,
      name: dto.name,
      address: dto.address,
      quotedMessageId: dto.quotedMessageId,
    };
    return this.dispatch(instanceId, 'location', payload, dto.clientMessageId);
  }

  async sendContact(instanceId: string, dto: SendContactDto): Promise<SendOutcome> {
    await this.cap(instanceId, 'contact', (x) => x.sendContact);
    const payload: SendContactInput = {
      to: dto.to,
      contacts: dto.contacts,
      quotedMessageId: dto.quotedMessageId,
    };
    return this.dispatch(instanceId, 'contact', payload, dto.clientMessageId);
  }

  async pollResults(instanceId: string, messageId: string): Promise<PollResults> {
    const results = await this.polls.results(instanceId, messageId);
    if (!results) throw new NotFoundException(`Enquete ${messageId} não encontrada`);
    return results;
  }

  // ── ações sobre mensagens existentes (gate de capability → 501) ──

  async reactMessage(instanceId: string, dto: ReactMessageDto): Promise<SendResult> {
    const p = await this.cap(instanceId, 'reactions', (x) => x.reactMessage);
    const input: ReactMessageInput = {
      chatId: dto.to,
      messageId: dto.messageId,
      emoji: dto.emoji,
      fromMe: dto.fromMe,
      participant: dto.participant,
    };
    return p.reactMessage!(input);
  }

  async editMessage(instanceId: string, dto: EditMessageDto): Promise<SendResult> {
    const p = await this.cap(instanceId, 'editMessage', (x) => x.editMessage);
    const input: EditMessageInput = {
      chatId: dto.to,
      messageId: dto.messageId,
      text: dto.text,
      fromMe: dto.fromMe,
      participant: dto.participant,
    };
    return p.editMessage!(input);
  }

  async deleteMessage(instanceId: string, dto: DeleteMessageDto): Promise<SendResult> {
    const p = await this.cap(instanceId, 'deleteMessage', (x) => x.deleteMessage);
    const input: DeleteMessageInput = {
      chatId: dto.to,
      messageId: dto.messageId,
      forEveryone: dto.forEveryone,
      fromMe: dto.fromMe,
      participant: dto.participant,
    };
    return p.deleteMessage!(input);
  }

  /** Pede a localização do usuário (Cloud API). Gated por capability + método. */
  async requestLocation(instanceId: string, dto: RequestLocationDto): Promise<SendResult> {
    const p = await this.cap(instanceId, 'location', (x) => x.requestLocation);
    return p.requestLocation!(dto.to, dto.text);
  }

  /** Status/Stories é broadcast: chamada direta (fora da dispatch/inbox/rate-limit). */
  async sendStatus(instanceId: string, dto: SendStatusDto): Promise<SendResult> {
    const p = await this.cap(instanceId, 'status', (x) => x.sendStatus);
    const input: SendStatusInput = {
      type: dto.type,
      text: dto.text,
      caption: dto.caption,
      url: dto.url,
      base64: dto.base64,
      mimetype: dto.mimetype,
      backgroundColor: dto.backgroundColor,
      font: dto.font,
      statusJidList: dto.statusJidList,
    };
    return p.sendStatus!(input);
  }

  /** Provider vivo que suporta `flag` E expõe o método. Único ponto de 501. */
  private async cap(
    instanceId: string,
    flag: keyof ProviderCapabilities,
    pick: (p: WhatsAppProvider) => unknown,
  ): Promise<WhatsAppProvider> {
    const provider = await this.manager.requireLive(instanceId);
    if (!provider.capabilities[flag] || typeof pick(provider) !== 'function') {
      throw new NotImplementedException(
        `A engine "${provider.type}" não suporta esta operação (${String(flag)}).`,
      );
    }
    return provider;
  }

  /** Lança 422 se a engine não entrega o recurso. */
  private async requireCapability(
    instanceId: string,
    feature: keyof ProviderCapabilities,
  ): Promise<void> {
    const provider = await this.manager.requireLive(instanceId);
    if (!provider.capabilities[feature]) {
      throw new UnprocessableEntityException({
        code: 'interactiveUnsupported',
        feature,
        provider: provider.type,
        message: `Engine ${provider.type} não entrega "${feature}". Use fallbackToText ou a engine Cloud.`,
      });
    }
  }

  /** Decide entre enviar interativo ou degradar para texto (fallbackToText). */
  private async resolveInteractive(
    instanceId: string,
    feature: keyof ProviderCapabilities,
    input: SendButtonsInput | SendListInput | SendPixInput,
  ): Promise<OutboundKind> {
    const provider = await this.manager.requireLive(instanceId);
    if (provider.capabilities[feature]) return feature as OutboundKind;
    if (input.fallbackToText) return 'text';
    throw new UnprocessableEntityException({
      code: 'interactiveUnsupported',
      feature,
      provider: provider.type,
    });
  }

  /** Converte o interativo em texto formatado quando caiu para 'text'. */
  private maybeText(
    kind: OutboundKind,
    input: SendButtonsInput | SendListInput | SendPixInput,
  ): OutboundPayload {
    if (kind !== 'text') return input;
    // renderFallbackText é protegido no adapter; aqui montamos um texto simples.
    if ('buttons' in input) {
      const opts = input.buttons
        .map((b, i) => `${i + 1}. ${b.title}${b.type === 'url' ? ` — ${b.url}` : ''}`)
        .join('\n');
      return {
        to: input.to,
        text: [input.text, '', opts, input.footer].filter(Boolean).join('\n'),
      };
    }
    if ('sections' in input) {
      const opts = input.sections
        .flatMap((s) => [s.title ? `*${s.title}*` : '', ...s.rows.map((r) => `• ${r.title}`)])
        .filter(Boolean)
        .join('\n');
      return {
        to: input.to,
        text: [input.title, input.text, '', opts, input.footer].filter(Boolean).join('\n'),
      };
    }
    return {
      to: input.to,
      text: [
        `*${input.pix.merchant}*`,
        `Chave PIX (${input.pix.keyType}): ${input.pix.key}`,
        input.pix.code ? `\nCopia e cola:\n${input.pix.code}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    };
  }

  async queueStatus(jobId: string): Promise<Record<string, unknown>> {
    const job = await this.queue.getJob(jobId);
    if (!job) throw new NotFoundException(`Job ${jobId} não encontrado`);
    return {
      jobId,
      state: await job.getState(),
      attemptsMade: job.attemptsMade,
      returnValue: job.returnvalue,
      failedReason: job.failedReason,
    };
  }

  // ── núcleo ────────────────────────────────────────────────

  private async dispatch(
    instanceId: string,
    kind: OutboundKind,
    payload: OutboundPayload,
    clientMessageId?: string,
  ): Promise<SendOutcome> {
    // 0) filtro de JID de saída: bloqueio nunca silencioso.
    if (!(await this.jidFilter.allows(instanceId, payload.to, 'outbound'))) {
      throw new ForbiddenException(
        `Envio para ${payload.to} bloqueado pelo filtro de JIDs desta instância`,
      );
    }

    const idemKey = clientMessageId ? `${instanceId}:${clientMessageId}` : undefined;

    // 1) idempotência
    if (idemKey) {
      const state = await this.idem.begin(idemKey);
      if (state.status === 'done') {
        return { id: state.result, to: payload.to, status: 'sent', duplicate: true };
      }
      if (state.status === 'in_progress') {
        return { status: 'in_progress', duplicate: true };
      }
    }

    // 2) rate limit por instância
    const rate = this.rate();
    const { allowed } = await this.limiter.consume(instanceId, rate.capacity, rate.refillPerSec);

    if (allowed) {
      try {
        const result = await this.send(instanceId, kind, payload);
        if (idemKey) await this.idem.complete(idemKey, result.id);
        // `result.to` é o destino já resolvido/normalizado pelo PRÓPRIO
        // provider (cada engine tem seu `toJid`/`toChatId`/`toNumber`) —
        // usar isso em vez de `payload.to` (o que o cliente da API mandou
        // cru, ex.: "5511999999999" sem "@s.whatsapp.net") garante que o
        // mesmo contato real vira a MESMA chatId tanto no outbound quanto
        // no inbound (que já chega normalizado pelo protocolo da própria
        // lib) — sem isso, o mesmo contato podia virar duas linhas em
        // `contacts` dependendo de quem mandou a primeira mensagem.
        void this.messageLog.recordOutbound({
          id: result.id,
          instanceId,
          chatId: result.to,
          clientMessageId,
        });
        void this.inboxStore.onOutbound({
          instanceId,
          chatId: result.to,
          id: result.id,
          kind,
          payload,
          timestamp: result.timestamp,
        });
        return { ...result, queued: false };
      } catch (e) {
        if (idemKey) await this.idem.release(idemKey);
        throw e;
      }
    }

    // 3) estourou o limite → enfileira (o worker faz o pacing)
    const job = await this.queue.add(
      kind,
      { instanceId, kind, payload, idemKey, rate },
      { jobId: idemKey }, // idemKey como jobId também deduplica na fila
    );
    return { status: 'queued', queued: true, jobId: job.id, to: payload.to };
  }

  private async send(
    instanceId: string,
    kind: OutboundKind,
    payload: OutboundPayload,
  ): Promise<SendResult> {
    const provider = await this.manager.requireLive(instanceId);
    switch (kind) {
      case 'text':
        return provider.sendText(payload as SendTextInput);
      case 'media':
        return provider.sendMedia(payload as SendMediaInput);
      case 'poll':
        return provider.sendPoll(payload as SendPollInput);
      case 'buttons':
        return provider.sendButtons(payload as SendButtonsInput);
      case 'list':
        return provider.sendList(payload as SendListInput);
      case 'pix':
        return provider.sendPix(payload as SendPixInput);
      case 'location':
        return provider.sendLocation!(payload as SendLocationInput);
      case 'contact':
        return provider.sendContact!(payload as SendContactInput);
    }
  }

  private rate(): { capacity: number; refillPerSec: number } {
    const { perSec, burst } = this.settings.get().rateLimit;
    return { capacity: burst, refillPerSec: perSec };
  }
}
