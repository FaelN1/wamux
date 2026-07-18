import {
  BadRequestException,
  Injectable,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import { CreateNewsletterInput, NewsletterInfo, SendResult } from '../providers/provider.types';
import { SendNewsletterMessageDto } from './dto/send-newsletter-message.dto';

/** Gerência de canais (@newsletter). Capability guard → 501 uniforme. */
@Injectable()
export class NewsletterService {
  constructor(private readonly manager: InstanceManagerService) {}

  async list(id: string): Promise<NewsletterInfo[]> {
    return (await this.requireCapable(id)).listNewsletters!();
  }
  async create(id: string, input: CreateNewsletterInput): Promise<NewsletterInfo> {
    return (await this.requireCapable(id)).createNewsletter!(input);
  }
  async metadata(id: string, jid: string): Promise<NewsletterInfo> {
    return (await this.requireCapable(id)).newsletterMetadata!(jid);
  }
  async follow(id: string, jid: string): Promise<void> {
    return (await this.requireCapable(id)).followNewsletter!(jid);
  }
  async unfollow(id: string, jid: string): Promise<void> {
    return (await this.requireCapable(id)).unfollowNewsletter!(jid);
  }

  /**
   * Mídia (`newsletterMedia`) e enquete (`newsletterPoll`) são gated à parte
   * de `newsletter` — nenhuma engine suportada garante os dois de forma
   * uniforme (ver docs/newsletter-contract-handoff.md pro detalhe por
   * engine/tipo, inclusive `newsletterUnsupportedMediaTypes` pra exceções
   * pontuais dentro de `newsletterMedia: true`, ex.: document no webjs).
   */
  async sendMessage(id: string, jid: string, dto: SendNewsletterMessageDto): Promise<SendResult> {
    const hasMedia = Boolean(dto.mediaUrl || dto.mediaBase64);
    const hasPoll = Boolean(dto.pollQuestion && dto.pollOptions?.length);
    if (!dto.text && !hasMedia && !hasPoll) {
      throw new BadRequestException(
        'Informe "text", mídia (mediaUrl/mediaBase64) ou enquete (pollQuestion/pollOptions) para o canal.',
      );
    }

    const provider = await this.requireCapable(id);

    if (hasPoll) {
      if (!provider.capabilities.newsletterPoll) {
        throw new UnprocessableEntityException({
          code: 'newsletterPollUnsupported',
          provider: provider.type,
          message: `Enquete em canal não é suportada na engine "${provider.type}".`,
        });
      }
      return provider.sendPoll({
        to: jid,
        question: dto.pollQuestion!,
        options: dto.pollOptions!,
        selectableCount: dto.pollSelectableCount,
      });
    }

    if (hasMedia) {
      if (!provider.capabilities.newsletterMedia) {
        throw new UnprocessableEntityException({
          code: 'newsletterMediaUnsupported',
          provider: provider.type,
          message: `Envio de mídia em canal não é suportado na engine "${provider.type}" — use "text".`,
        });
      }
      if (provider.capabilities.newsletterUnsupportedMediaTypes?.includes(dto.mediaType!)) {
        throw new UnprocessableEntityException({
          code: 'newsletterMediaTypeUnsupported',
          provider: provider.type,
          mediaType: dto.mediaType,
          message: `Tipo de mídia "${dto.mediaType}" não é suportado em canal na engine "${provider.type}".`,
        });
      }
      return provider.sendMedia({
        to: jid,
        type: dto.mediaType ?? 'image',
        url: dto.mediaUrl,
        base64: dto.mediaBase64,
        caption: dto.caption ?? dto.text,
        filename: dto.filename,
        mimetype: dto.mimetype,
      });
    }

    return provider.sendText({ to: jid, text: dto.text! });
  }

  private async requireCapable(id: string): Promise<WhatsAppProvider> {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.newsletter || !provider.listNewsletters) {
      throw new NotImplementedException(
        `A engine "${provider.type}" não suporta canais (newsletter).`,
      );
    }
    return provider;
  }
}
