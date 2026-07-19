import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { Readable } from 'node:stream';
import { BaseProvider, ProviderContext } from '../provider.interface';
import {
  ConnectionStatus,
  CreateTemplateInput,
  CreateTemplateResult,
  DeleteTemplateInput,
  EditTemplatePatch,
  MessageAckStatus,
  MessageTemplate,
  MessageType,
  NormalizedMessage,
  ProviderType,
  ReactMessageInput,
  SendButtonsInput,
  SendContactInput,
  SendListInput,
  SendLocationInput,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
  TemplateAnalyticsQuery,
  TemplateFilter,
  WebhookEvent,
} from '../provider.types';

/**
 * Provider OFICIAL (WhatsApp Cloud API / Meta).
 *
 * Não há socket nem QR: a "conexão" é um número já verificado na Meta, e a
 * autenticação é um access token. Mensagens SAEM via REST (Graph API) e
 * ENTRAM via webhook da Meta → `handleInboundWebhook`.
 *
 * Config esperada na instância:
 *   { phoneNumberId, accessToken, wabaId?, managementToken?, appId?,
 *     cloudApiBaseUrl?, cloudApiVersion? }
 *
 * Dois tokens/clients: `this.http` (messaging, phoneNumberId — envio/mídia) e
 * `this.mgmt` (management, wabaId — templates/flows/perfil/conta). Se
 * `managementToken` faltar, reusa o `accessToken`.
 */
export class CloudApiProvider extends BaseProvider {
  readonly type = ProviderType.CLOUD_API;
  /** A API oficial da Meta expõe reação/localização/contato/download; NÃO editar/apagar/status. */
  readonly capabilities = {
    reactions: true,
    location: true,
    contact: true,
    media: true,
    markRead: true,
    block: true,
    buttons: true,
    list: true,
    templates: true,
  };

  /** client de MESSAGING (token de messaging, opera sobre phoneNumberId). */
  private http!: AxiosInstance;
  /** client de MANAGEMENT (token de management, opera sobre wabaId/appId). */
  private mgmt!: AxiosInstance;
  private messagingToken!: string;
  private baseUrl!: string;

  constructor(ctx: ProviderContext) {
    super(ctx);
  }

  private get phoneNumberId(): string {
    const v = this.config.phoneNumberId as string | undefined;
    if (!v) throw new Error('Cloud API: config.phoneNumberId ausente');
    return v;
  }

  /** WABA id — exigido pelos fluxos de management (templates/flows/conta). */
  protected get wabaId(): string {
    const v = this.config.wabaId as string | undefined;
    if (!v) throw new Error('Cloud API: config.wabaId ausente (necessário para esta operação)');
    return v;
  }

  async initialize(): Promise<void> {
    const accessToken = this.config.accessToken as string | undefined;
    if (!accessToken) throw new Error('Cloud API: config.accessToken ausente');

    const baseUrl = (this.config.cloudApiBaseUrl as string) ?? 'https://graph.facebook.com';
    const version = (this.config.cloudApiVersion as string) ?? 'v21.0';
    this.baseUrl = `${baseUrl}/${version}`;
    this.messagingToken = accessToken;

    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 20_000,
    });
    // Token de management: escopo whatsapp_business_management. Fallback: o
    // mesmo accessToken (quando já carrega ambos os escopos).
    this.mgmt = axios.create({
      baseURL: this.baseUrl,
      headers: {
        Authorization: `Bearer ${(this.config.managementToken as string) ?? accessToken}`,
      },
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
      ...this.context(input.quotedMessageId),
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
      ...this.context(input.quotedMessageId),
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

  async sendLocation(input: SendLocationInput): Promise<SendResult> {
    const to = this.toNumber(input.to);
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'location',
      location: {
        latitude: input.latitude,
        longitude: input.longitude,
        name: input.name,
        address: input.address,
      },
      ...this.context(input.quotedMessageId),
    });
    return this.result(res.data, to);
  }

  async sendContact(input: SendContactInput): Promise<SendResult> {
    const to = this.toNumber(input.to);
    const contacts = input.contacts.map((c) => {
      const digits = (c.phone ?? '').replace(/\D/g, '');
      return {
        name: { formatted_name: c.fullName, first_name: c.fullName },
        ...(c.organization ? { org: { company: c.organization } } : {}),
        ...(digits ? { phones: [{ phone: digits, type: 'CELL', wa_id: digits }] } : {}),
      };
    });
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'contacts',
      contacts,
      ...this.context(input.quotedMessageId),
    });
    return this.result(res.data, to);
  }

  /**
   * Interactive `button` (≤3 reply) OU `cta_url` (1 url) — a Cloud não mistura
   * os dois num payload. Fora desses casos, degrada para texto (fallbackToText).
   */
  async sendButtons(input: SendButtonsInput): Promise<SendResult> {
    const to = this.toNumber(input.to);
    const replies = input.buttons.filter((b) => b.type === 'reply');
    const urls = input.buttons.filter((b) => b.type === 'url');
    let interactive: Record<string, unknown> | undefined;

    if (replies.length === input.buttons.length && replies.length >= 1 && replies.length <= 3) {
      interactive = {
        type: 'button',
        body: { text: input.text },
        ...(input.footer ? { footer: { text: input.footer } } : {}),
        action: {
          buttons: replies.map((b) => ({
            type: 'reply',
            reply: { id: (b as { id?: string }).id, title: b.title },
          })),
        },
      };
    } else if (input.buttons.length === 1 && urls.length === 1) {
      const u = urls[0] as { title: string; url: string };
      interactive = {
        type: 'cta_url',
        body: { text: input.text },
        ...(input.footer ? { footer: { text: input.footer } } : {}),
        action: { name: 'cta_url', parameters: { display_text: u.title, url: u.url } },
      };
    }

    if (!interactive) {
      if (input.fallbackToText === false) {
        throw new Error('Cloud API: só ≤3 botões reply OU exatamente 1 botão url');
      }
      return this.sendText({ to: input.to, text: this.renderFallbackText(input) });
    }

    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive,
      ...this.context(input.quotedMessageId),
    });
    return this.result(res.data, to);
  }

  async sendList(input: SendListInput): Promise<SendResult> {
    const to = this.toNumber(input.to);
    const interactive = {
      type: 'list',
      ...(input.title ? { header: { type: 'text', text: input.title } } : {}),
      body: { text: input.text },
      ...(input.footer ? { footer: { text: input.footer } } : {}),
      action: {
        button: input.buttonText,
        sections: input.sections.map((s) => ({
          ...(s.title ? { title: s.title } : {}),
          rows: s.rows.map((r) => ({
            id: r.id,
            title: r.title,
            ...(r.description ? { description: r.description } : {}),
          })),
        })),
      },
    };
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive,
      ...this.context(input.quotedMessageId),
    });
    return this.result(res.data, to);
  }

  /**
   * Marca lido via `status:read`. A Cloud exige o `message_id` INBOUND (não o
   * chat) e aceita 1 por chamada — sem ids, não há o que marcar (no-op).
   */
  async markRead(_chatId: string, messageIds?: string[]): Promise<void> {
    for (const id of messageIds ?? []) {
      await this.http.post(`/${this.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: id,
      });
    }
  }

  async blockContact(jid: string): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}/block_users`, {
      messaging_product: 'whatsapp',
      block_users: [{ user: this.toNumber(jid) }],
    });
  }

  async unblockContact(jid: string): Promise<void> {
    await this.http.delete(`/${this.phoneNumberId}/block_users`, {
      data: { messaging_product: 'whatsapp', block_users: [{ user: this.toNumber(jid) }] },
    });
  }

  /** Pede a localização do usuário (interactive location_request_message). */
  async requestLocation(to: string, text: string): Promise<SendResult> {
    const num = this.toNumber(to);
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: num,
      type: 'interactive',
      interactive: {
        type: 'location_request_message',
        body: { text },
        action: { name: 'send_location' },
      },
    });
    return this.result(res.data, num);
  }

  // ── templates HSM (management token = WABA; send = messaging token) ──

  private readonly TEMPLATE_FIELDS =
    'id,name,language,category,status,quality_score,components,parameter_format';

  async listTemplates(filter?: TemplateFilter): Promise<MessageTemplate[]> {
    const params: Record<string, string> = { fields: this.TEMPLATE_FIELDS, limit: '100' };
    if (filter?.category) params.category = filter.category;
    if (filter?.status) params.status = filter.status;
    if (filter?.language) params.language = filter.language;
    if (filter?.name) params.name = filter.name;
    const res = await this.mgmt.get(`/${this.wabaId}/message_templates`, { params });
    return ((res.data as { data?: MessageTemplate[] })?.data ?? []) as MessageTemplate[];
  }

  async getTemplate(idOrName: string): Promise<MessageTemplate> {
    if (/^\d+$/.test(idOrName)) {
      const res = await this.mgmt.get(`/${idOrName}`, { params: { fields: this.TEMPLATE_FIELDS } });
      return res.data as MessageTemplate;
    }
    const found = (await this.listTemplates({ name: idOrName })).find((t) => t.name === idOrName);
    if (!found) throw new Error(`Template "${idOrName}" não encontrado`);
    return found;
  }

  async createTemplate(input: CreateTemplateInput): Promise<CreateTemplateResult> {
    const res = await this.mgmt.post(`/${this.wabaId}/message_templates`, {
      name: input.name,
      language: input.language,
      category: input.category,
      components: input.components,
      ...(input.parameter_format ? { parameter_format: input.parameter_format } : {}),
      ...(input.allow_category_change != null
        ? { allow_category_change: input.allow_category_change }
        : {}),
    });
    const d = res.data as CreateTemplateResult;
    return { id: d?.id, status: d?.status, category: d?.category };
  }

  /** Só `category`/`components`, e só se o template estiver APPROVED/REJECTED. */
  async editTemplate(id: string, patch: EditTemplatePatch): Promise<void> {
    await this.mgmt.post(`/${id}`, {
      ...(patch.category ? { category: patch.category } : {}),
      ...(patch.components ? { components: patch.components } : {}),
    });
  }

  /** Sem `hsmId` apaga TODAS as línguas do nome; com `hsmId`, só aquele locale. */
  async deleteTemplate(input: DeleteTemplateInput): Promise<void> {
    const params: Record<string, string> = { name: input.name };
    if (input.hsmId) params.hsm_id = input.hsmId;
    await this.mgmt.delete(`/${this.wabaId}/message_templates`, { params });
  }

  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    const to = this.toNumber(input.to);
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: input.name,
        language: { code: input.language },
        ...(input.components ? { components: input.components } : {}),
      },
      ...this.context(input.quotedMessageId),
    });
    return this.result(res.data, to);
  }

  async templateAnalytics(query: TemplateAnalyticsQuery): Promise<unknown> {
    const params: Record<string, string> = {
      start: String(query.start),
      end: String(query.end),
      granularity: query.granularity ?? 'DAILY',
      template_ids: JSON.stringify(query.templateIds),
    };
    if (query.metricTypes?.length) params.metric_types = JSON.stringify(query.metricTypes);
    const res = await this.mgmt.get(`/${this.wabaId}/template_analytics`, { params });
    return res.data;
  }

  /**
   * Baixa a mídia de uma mensagem inbound. Dois passos: GET /{media-id} devolve
   * uma URL assinada (expira em ~5 min) + metadados; o download real exige o
   * header de auth TAMBÉM na URL assinada (omiti-lo falha).
   */
  async downloadMedia(msg: NormalizedMessage): Promise<Readable | null> {
    const raw = msg.raw as CloudMessage;
    const mediaId =
      raw?.image?.id ?? raw?.video?.id ?? raw?.audio?.id ?? raw?.document?.id ?? raw?.sticker?.id;
    if (!mediaId) return null;

    const meta = await this.http.get(`/${mediaId}`);
    const url = (meta.data as { url?: string })?.url;
    if (!url) return null;

    const bin = await axios.get(url, {
      headers: { Authorization: `Bearer ${this.messagingToken}` },
      responseType: 'stream',
      timeout: 30_000,
    });
    return bin.data as Readable;
  }

  async logout(): Promise<void> {
    // Não há sessão para encerrar; apenas marca desconectado.
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  async destroy(): Promise<void> {
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  /**
   * Webhook de entrada da Meta — roteado por `change.field`. Templates (fase 2),
   * Flows (4) e Calling (6) chegam pelo MESMO webhook, com `field` diferente;
   * cada fase pluga um `case` aqui.
   */
  async handleInboundWebhook(payload: unknown): Promise<void> {
    const body = payload as CloudWebhookBody;
    for (const entry of body?.entry ?? []) {
      for (const change of entry.changes ?? []) {
        switch (change.field) {
          case 'messages':
            this.handleMessagesChange(change.value);
            break;
          case 'message_template_status_update':
            this.emitWebhook(WebhookEvent.TEMPLATE_STATUS_UPDATE, change.value);
            break;
          case 'message_template_quality_update':
            this.emitWebhook(WebhookEvent.TEMPLATE_QUALITY_UPDATE, change.value);
            break;
          case 'template_category_update':
            this.emitWebhook(WebhookEvent.TEMPLATE_CATEGORY_UPDATE, change.value);
            break;
          default:
            this.logger.debug(`[cloud] webhook field não tratado: ${change.field}`);
        }
      }
    }
  }

  // ── webhook: handlers por field ──────────────────────────────

  /** `messages[]` (inbound) + `statuses[]` (sent/delivered/read/failed) no mesmo value. */
  private handleMessagesChange(value?: CloudChangeValue): void {
    const contactName = value?.contacts?.[0]?.profile?.name;
    for (const msg of value?.messages ?? []) {
      this.emitTyped('message', this.normalize(msg, contactName));
    }
    for (const st of value?.statuses ?? []) {
      this.emitTyped('message.status', {
        provider: this.type,
        instanceId: this.instanceId,
        messageId: st.id,
        chatId: st.recipient_id,
        status: this.mapStatus(st.status),
        timestamp: Number(st.timestamp ?? 0),
        ...(st.errors?.length
          ? {
              error: {
                code: st.errors[0].code,
                title: st.errors[0].title,
                message: st.errors[0].message,
              },
            }
          : {}),
      });
    }
  }

  // ── helpers ───────────────────────────────────────────────

  private toNumber(to: string): string {
    return to.replace(/\D/g, '');
  }

  /** Envelope `context` para reply/quote (mesmo formato em todos os tipos). */
  private context(quotedMessageId?: string): Record<string, unknown> {
    return quotedMessageId ? { context: { message_id: quotedMessageId } } : {};
  }

  private mapStatus(s?: string): MessageAckStatus {
    switch (s) {
      case 'sent':
        return MessageAckStatus.SERVER;
      case 'delivered':
        return MessageAckStatus.DELIVERED;
      case 'read':
        return MessageAckStatus.READ;
      case 'failed':
        return MessageAckStatus.FAILED;
      default:
        return MessageAckStatus.PENDING;
    }
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
    let location: NormalizedMessage['location'];

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
      case 'sticker':
        type = MessageType.STICKER;
        media = { mimetype: msg.sticker?.mime_type };
        break;
      case 'location':
        type = MessageType.LOCATION;
        if (msg.location) {
          location = {
            latitude: msg.location.latitude,
            longitude: msg.location.longitude,
            name: msg.location.name,
            address: msg.location.address,
          };
        }
        break;
      case 'interactive':
        // resposta de botão/lista/flow — o texto vira o título/valor selecionado.
        type = MessageType.INTERACTIVE;
        text =
          msg.interactive?.button_reply?.title ??
          msg.interactive?.list_reply?.title ??
          msg.interactive?.nfm_reply?.body;
        break;
      case 'button':
        // quick-reply de TEMPLATE (diferente de interactive.button_reply).
        type = MessageType.INTERACTIVE;
        text = msg.button?.text;
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
      location,
      raw: msg,
    };
  }
}

// ── tipos parciais do payload da Meta ────────────────────────
interface CloudSendResponse {
  messages?: { id: string }[];
}
interface CloudMediaRef {
  id?: string;
  mime_type?: string;
  caption?: string;
  filename?: string;
}
interface CloudMessage {
  id: string;
  from: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  image?: CloudMediaRef;
  video?: CloudMediaRef;
  audio?: CloudMediaRef;
  document?: CloudMediaRef;
  sticker?: CloudMediaRef;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
    nfm_reply?: { name?: string; body?: string; response_json?: string };
  };
  button?: { text?: string; payload?: string };
}
interface CloudStatus {
  id: string;
  status?: string;
  timestamp?: string;
  recipient_id: string;
  errors?: { code?: number; title?: string; message?: string }[];
}
interface CloudChangeValue {
  contacts?: { profile?: { name?: string } }[];
  messages?: CloudMessage[];
  statuses?: CloudStatus[];
}
interface CloudWebhookBody {
  entry?: {
    changes?: { field?: string; value?: CloudChangeValue }[];
  }[];
}
