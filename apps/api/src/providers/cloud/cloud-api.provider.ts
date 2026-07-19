import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { BaseProvider, ProviderContext } from '../provider.interface';
import {
  ConnectionStatus,
  MessageType,
  NormalizedMessage,
  ProviderType,
  ReactMessageInput,
  SendMediaInput,
  SendResult,
  SendTextInput,
} from '../provider.types';

/**
 * Provider OFICIAL (WhatsApp Cloud API / Meta).
 *
 * Não há socket nem QR: a "conexão" é um número já verificado na Meta, e a
 * autenticação é um access token. Mensagens SAEM via REST (Graph API) e
 * ENTRAM via webhook da Meta → `handleInboundWebhook`.
 *
 * Config esperada na instância:
 *   { "phoneNumberId": "...", "accessToken": "...", "wabaId": "..." }
 */
export class CloudApiProvider extends BaseProvider {
  readonly type = ProviderType.CLOUD_API;
  /** A API oficial da Meta expõe reação/localização/contato, mas NÃO editar/apagar/status. */
  readonly capabilities = {
    reactions: true,
  };
  private http!: AxiosInstance;

  constructor(ctx: ProviderContext) {
    super(ctx);
  }

  private get phoneNumberId(): string {
    const v = this.config.phoneNumberId as string | undefined;
    if (!v) throw new Error('Cloud API: config.phoneNumberId ausente');
    return v;
  }

  async initialize(): Promise<void> {
    const accessToken = this.config.accessToken as string | undefined;
    if (!accessToken) throw new Error('Cloud API: config.accessToken ausente');

    const baseUrl = (this.config.cloudApiBaseUrl as string) ?? 'https://graph.facebook.com';
    const version = (this.config.cloudApiVersion as string) ?? 'v21.0';

    this.http = axios.create({
      baseURL: `${baseUrl}/${version}`,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20_000,
    });

    // Número já está "conectado" no lado da Meta.
    this.setStatus(ConnectionStatus.CONNECTED, { wid: this.phoneNumberId });
  }

  async getQRCode(): Promise<null> {
    return null; // Cloud API não usa QR.
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const to = this.toNumber(input.to);
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: input.linkPreview !== false, body: input.text },
    });
    return this.result(res.data, to);
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const to = this.toNumber(input.to);
    const mediaKey = input.type; // image | video | audio | document | sticker
    const media: Record<string, unknown> = {};

    if (input.url) {
      media.link = input.url;
    } else if (input.base64) {
      // A Cloud API não aceita base64 inline: sobe a mídia e referencia por id.
      media.id = await this.uploadMedia(input.base64, input.mimetype, input.filename);
    } else {
      throw new Error('Cloud API: informe "url" ou "base64" da mídia');
    }

    if (
      input.caption &&
      (input.type === 'image' || input.type === 'video' || input.type === 'document')
    ) {
      media.caption = input.caption;
    }
    if (input.type === 'document' && input.filename) media.filename = input.filename;

    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: mediaKey,
      [mediaKey]: media,
    });
    return this.result(res.data, to);
  }

  /**
   * Sobe uma mídia (base64) em /{phoneNumberId}/media (multipart) e retorna o
   * media id, que é então usado no envio da mensagem.
   */
  private async uploadMedia(base64: string, mimetype?: string, filename?: string): Promise<string> {
    if (!mimetype) {
      throw new Error('Cloud API: "mimetype" é obrigatório no envio por base64');
    }
    const buffer = Buffer.from(base64, 'base64');
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimetype);
    form.append('file', buffer, { filename: filename ?? 'file', contentType: mimetype });

    const res = await this.http.post(`/${this.phoneNumberId}/media`, form, {
      headers: form.getHeaders(),
    });
    const id = res.data?.id as string | undefined;
    if (!id) throw new Error('Cloud API: upload de mídia não retornou id');
    return id;
  }

  async reactMessage(input: ReactMessageInput): Promise<SendResult> {
    const to = this.toNumber(input.chatId);
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'reaction',
      reaction: { message_id: input.messageId, emoji: input.emoji },
    });
    return this.result(res.data, to);
  }

  async logout(): Promise<void> {
    // Não há sessão para encerrar; apenas marca desconectado.
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  async destroy(): Promise<void> {
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  /**
   * Webhook de entrada da Meta. Estrutura:
   * entry[].changes[].value.messages[] + .contacts[] + .statuses[]
   */
  async handleInboundWebhook(payload: unknown): Promise<void> {
    const body = payload as CloudWebhookBody;
    for (const entry of body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        const contactName = value?.contacts?.[0]?.profile?.name;
        for (const msg of value?.messages ?? []) {
          this.emitTyped('message', this.normalize(msg, contactName));
        }
        // status updates (sent/delivered/read) poderiam virar 'message.status' aqui.
      }
    }
  }

  // ── helpers ───────────────────────────────────────────────

  private toNumber(to: string): string {
    return to.replace(/\D/g, '');
  }

  private result(data: CloudSendResponse, to: string): SendResult {
    return {
      id: data?.messages?.[0]?.id ?? '',
      to,
      timestamp: Math.floor(Date.now() / 1000),
      status: 'sent',
    };
  }

  private normalize(msg: CloudMessage, pushName?: string): NormalizedMessage {
    let type = MessageType.UNKNOWN;
    let text: string | undefined;
    let media: NormalizedMessage['media'];

    switch (msg.type) {
      case 'text':
        type = MessageType.TEXT;
        text = msg.text?.body;
        break;
      case 'image':
        type = MessageType.IMAGE;
        text = msg.image?.caption;
        media = { mimetype: msg.image?.mime_type, caption: text };
        break;
      case 'video':
        type = MessageType.VIDEO;
        media = { mimetype: msg.video?.mime_type, caption: msg.video?.caption };
        break;
      case 'audio':
        type = MessageType.AUDIO;
        media = { mimetype: msg.audio?.mime_type };
        break;
      case 'document':
        type = MessageType.DOCUMENT;
        media = { mimetype: msg.document?.mime_type, filename: msg.document?.filename };
        break;
    }

    return {
      provider: this.type,
      instanceId: this.instanceId,
      id: msg.id,
      chatId: msg.from,
      from: msg.from,
      fromMe: false,
      pushName,
      isGroup: false, // Cloud API não trata grupos da mesma forma
      timestamp: Number(msg.timestamp ?? 0),
      type,
      text,
      media,
      raw: msg,
    };
  }
}

// ── tipos parciais do payload da Meta ────────────────────────
interface CloudSendResponse {
  messages?: { id: string }[];
}
interface CloudMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  image?: { mime_type?: string; caption?: string };
  video?: { mime_type?: string; caption?: string };
  audio?: { mime_type?: string };
  document?: { mime_type?: string; filename?: string };
}
interface CloudWebhookBody {
  entry?: {
    changes?: {
      value?: {
        contacts?: { profile?: { name?: string } }[];
        messages?: CloudMessage[];
      };
    }[];
  }[];
}
