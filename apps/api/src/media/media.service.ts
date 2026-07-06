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

/** Fonte pronta para o adapter: url (streaming) OU buffer pequeno. */
export interface OutboundSource {
  url?: string;
  buffer?: Buffer;
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
  private readonly inlineMax: number;
  private readonly maxBytes: number;

  constructor(
    private readonly config: ConfigService,
    @Inject(MEDIA_STORE) private readonly store: MediaStore,
  ) {
    this.inlineMax = this.config.get<number>('media.inlineMaxBytes') ?? 262144;
    this.maxBytes = (this.config.get<number>('media.maxSizeMb') ?? 100) * 1024 * 1024;
  }

  /** Normaliza a fonte de saída — evita Buffer gigante no heap. */
  async prepareOutbound(instanceId: string, dto: SendMediaDto): Promise<OutboundSource> {
    if (dto.url) return { url: dto.url, mimetype: dto.mimetype, filename: dto.filename };
    if (!dto.base64) throw new BadRequestException('Informe "url" ou "base64" da mídia');

    const buf = Buffer.from(dto.base64, 'base64');
    if (buf.byteLength > this.maxBytes) {
      throw new PayloadTooLargeException(`Mídia acima do limite (${this.maxBytes} bytes)`);
    }
    if (buf.byteLength <= this.inlineMax) {
      return { buffer: buf, mimetype: dto.mimetype, filename: dto.filename };
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
      this.logger.warn(`[${msg.instanceId}] falha ao ingerir mídia ${msg.id}: ${msg.media.mediaError}`);
    }
  }

  async fetchStored(
    instanceId: string,
    messageId: string,
    includeBase64: boolean,
  ): Promise<{ stream?: Readable; base64?: string; mimetype?: string }> {
    const key = `inbound/${instanceId}/${messageId}`;
    const head = await this.store.stat(key);
    if (!head) throw new NotFoundException('Mídia não encontrada (ainda não ingerida ou expirada)');
    if (!includeBase64) return { stream: await this.store.getStream(key), mimetype: head.contentType };
    const buf = await this.store.getBuffer(key);
    return { base64: buf.toString('base64'), mimetype: head.contentType };
  }
}
