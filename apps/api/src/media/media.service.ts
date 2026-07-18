import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { WhatsAppProvider } from '../providers/provider.interface';
import { NormalizedMessage } from '../providers/provider.types';
import { MEDIA_STORE, MediaStore } from './media-store.interface';
import { SendMediaDto } from '../messaging/dto/send-media.dto';

/** Fonte pronta pro envio: sempre uma URL própria (subida ao store quando veio de base64). */
export interface OutboundSource {
  url?: string;
  mimetype?: string;
  filename?: string;
}

/**
 * Ponto único de normalização de mídia: entrada por url/base64,
 * ingestão no recebimento (streaming) e download sob demanda. Base64 grande
 * vira URL do store.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);
  private readonly maxBytes: number;

  constructor(
    private readonly config: ConfigService,
    @Inject(MEDIA_STORE) private readonly store: MediaStore,
  ) {
    this.maxBytes = (this.config.get<number>('media.maxSizeMb') ?? 100) * 1024 * 1024;
  }

  /**
   * Normaliza a fonte de saída. `base64` sempre sobe pro store e vira uma
   * URL própria — antes só subia acima de `inlineMax` (256KB), mas essa
   * ramificação nunca tinha um consumidor real até `MessagingService.sendMedia`
   * ser ligado a este método nesta sessão; a maioria das fotos/áudios reais
   * de composer fica ABAIXO desse limite, então quase nenhum envio ganhava
   * URL própria (achado em QA testando o composer do Inbox — sem URL, a
   * mídia enviada nunca re-renderiza na thread depois). Ficou consistente
   * com o inbound, que já sempre sobe pro store (`ingestInbound`, sem
   * ramificação de tamanho nenhuma).
   */
  async prepareOutbound(instanceId: string, dto: SendMediaDto): Promise<OutboundSource> {
    if (dto.url) return { url: dto.url, mimetype: dto.mimetype, filename: dto.filename };
    if (!dto.base64) throw new BadRequestException('Informe "url" ou "base64" da mídia');

    const buf = Buffer.from(dto.base64, 'base64');
    if (buf.byteLength > this.maxBytes) {
      throw new PayloadTooLargeException(`Mídia acima do limite (${this.maxBytes} bytes)`);
    }
    const key = `outbound/${instanceId}/${randomUUID()}`;
    const { url } = await this.store.put(key, buf, { contentType: dto.mimetype });
    return { url, mimetype: dto.mimetype, filename: dto.filename };
  }

  /** Baixa + sobe no store ANTES de emitir o evento `message`. */
  async ingestInbound(provider: WhatsAppProvider, msg: NormalizedMessage): Promise<void> {
    if (!msg.media || msg.media.url || !provider.downloadMedia) return;
    const key = `inbound/${msg.instanceId}/${msg.id}`;
    try {
      const stream = await provider.downloadMedia(msg);
      if (!stream) return;
      const { url, size } = await this.store.putStream(key, stream, {
        contentType: msg.media.mimetype,
      });
      msg.media.url = url;
      msg.media.size = size;
    } catch (e) {
      msg.media.mediaError = (e as Error).message; // nunca silencioso
      this.logger.warn(
        `[${msg.instanceId}] falha ao ingerir mídia ${msg.id}: ${msg.media.mediaError}`,
      );
    }
  }

  async fetchStored(
    instanceId: string,
    messageId: string,
    includeBase64: boolean,
  ): Promise<{ stream?: Readable; base64?: string; mimetype?: string; size?: number }> {
    const key = `inbound/${instanceId}/${messageId}`;
    const head = await this.store.stat(key);
    if (!head) throw new NotFoundException('Mídia não encontrada (ainda não ingerida ou expirada)');
    if (!includeBase64) {
      return {
        stream: await this.store.getStream(key),
        mimetype: head.contentType,
        size: head.size,
      };
    }
    const buf = await this.store.getBuffer(key);
    return { base64: buf.toString('base64'), mimetype: head.contentType };
  }

  /**
   * Serve mídia de SAÍDA (composer/API, promovida de base64 pra URL em
   * `prepareOutbound`). Rota pública (sem apikey) — o próprio engine (ex.
   * Baileys) busca essa URL via HTTP puro pra relayar ao WhatsApp.
   */
  async fetchStoredOutbound(
    instanceId: string,
    fileKey: string,
  ): Promise<{ stream: Readable; mimetype?: string; size: number }> {
    const key = `outbound/${instanceId}/${fileKey}`;
    const head = await this.store.stat(key);
    if (!head) throw new NotFoundException('Mídia não encontrada (ainda não enviada ou expirada)');
    return { stream: await this.store.getStream(key), mimetype: head.contentType, size: head.size };
  }
}
