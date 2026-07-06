import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
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
  SendButtonsInput,
  SendListInput,
  SendMediaInput,
  SendPixInput,
  SendPollInput,
  SendResult,
  SendTextInput,
} from '../providers/provider.types';
import { OUTBOUND_QUEUE, OutboundJob, OutboundKind, OutboundPayload } from './outbound.constants';
import { PollStore } from './poll-store.service';
import { MessageLogService } from './message-log.service';
import { MessageLogEntity } from './message-log.entity';
import { JidFilterService } from '../common/jid-filter.service';
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

  sendMedia(instanceId: string, dto: SendMediaDto): Promise<SendOutcome> {
    if (!dto.url && !dto.base64) {
      throw new BadRequestException('Informe "url" ou "base64" da mídia');
    }
    const payload: SendMediaInput = {
      to: dto.to,
      type: dto.type,
      url: dto.url,
      base64: dto.base64,
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

  async pollResults(instanceId: string, messageId: string): Promise<PollResults> {
    const results = await this.polls.results(instanceId, messageId);
    if (!results) throw new NotFoundException(`Enquete ${messageId} não encontrada`);
    return results;
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
      return { to: input.to, text: [input.text, '', opts, input.footer].filter(Boolean).join('\n') };
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
        void this.messageLog.recordOutbound({
          id: result.id,
          instanceId,
          chatId: payload.to,
          clientMessageId,
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
    }
  }

  private rate(): { capacity: number; refillPerSec: number } {
    const { perSec, burst } = this.settings.get().rateLimit;
    return { capacity: burst, refillPerSec: perSec };
  }
}
