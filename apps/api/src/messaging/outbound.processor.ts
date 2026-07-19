import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { DelayedError, Job } from 'bullmq';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { RateLimiterService } from '../throttle/rate-limiter.service';
import { IdempotencyService } from '../throttle/idempotency.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import {
  SendButtonsInput,
  SendListInput,
  SendLocationInput,
  SendMediaInput,
  SendPixInput,
  SendPollInput,
  SendResult,
  SendTextInput,
} from '../providers/provider.types';
import { OUTBOUND_QUEUE, OutboundJob, OutboundKind, OutboundPayload } from './outbound.constants';

/**
 * Worker de envio com **pacing por instância**: antes de enviar, tenta consumir
 * um token do rate limiter da instância; se não houver, reprograma o job
 * (moveToDelayed) para quando um token estará disponível. Assim as mensagens
 * saem espaçadas mesmo sob rajada — sem estourar o limite (anti-ban).
 */
@Processor(OUTBOUND_QUEUE, { concurrency: 10 })
export class OutboundProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboundProcessor.name);

  constructor(
    private readonly manager: InstanceManagerService,
    private readonly limiter: RateLimiterService,
    private readonly idem: IdempotencyService,
  ) {
    super();
  }

  async process(job: Job<OutboundJob>, token?: string): Promise<SendResult> {
    const { instanceId, kind, payload, idemKey, rate } = job.data;

    // Pacing: se estourou o limite, adia o job em vez de falhar.
    const { allowed, retryAfterMs } = await this.limiter.consume(
      instanceId,
      rate.capacity,
      rate.refillPerSec,
    );
    if (!allowed) {
      await job.moveToDelayed(Date.now() + retryAfterMs, token);
      throw new DelayedError();
    }

    try {
      const provider = await this.manager.requireLive(instanceId);
      const result = await this.send(provider, kind, payload);
      if (idemKey) await this.idem.complete(idemKey, result.id);
      return result;
    } catch (err) {
      // Esgotou as tentativas: libera a idempotência para permitir novo envio.
      const attempts = job.opts.attempts ?? 1;
      if (idemKey && job.attemptsMade + 1 >= attempts) {
        await this.idem.release(idemKey);
      }
      throw err;
    }
  }

  private send(
    provider: WhatsAppProvider,
    kind: OutboundKind,
    payload: OutboundPayload,
  ): Promise<SendResult> {
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
    }
  }
}
