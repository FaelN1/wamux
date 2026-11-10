import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { Readable } from 'node:stream';
import {
  BaseProvider,
  FlowEndpointHandlers,
  FlowEndpointHttpRequest,
  FlowTokenInvalidError,
  InboundWebhookMeta,
  ProviderContext,
  ProviderRequestError,
} from '../provider.interface';
import {
  FlowDecryptionError,
  decryptFlowRequest,
  encryptFlowResponse,
  generateFlowKeyPair,
  isEncryptedFlowRequest,
  publicKeyFromPrivate,
} from './flow-endpoint-crypto';
import { verifySha256Signature } from '../webhook-signature.util';
import { parseNfmReply } from '../flow-response.util';
import {
  ConnectCallInput,
  ConnectionStatus,
  PricingAnalyticsQuery,
  CreateFlowInput,
  CreateFlowResult,
  CreateTemplateInput,
  CreateTemplateResult,
  DeleteTemplateInput,
  EditTemplatePatch,
  Flow,
  FlowAsset,
  FlowEncryptionInfo,
  FlowResponse,
  SetFlowEncryptionInput,
  UpdateFlowMetadataInput,
  GroupInfo,
  MessageAckStatus,
  MessageTemplate,
  MessagingAnalyticsQuery,
  MessageType,
  NormalizedDeletion,
  NormalizedEdit,
  NormalizedMessage,
  NormalizedReaction,
  PhoneNumberInfo,
  ProfileInfo,
  ProviderType,
  RegisterNumberInput,
  RequestCodeInput,
  UpdateProfileInput,
  ReactMessageInput,
  SendButtonsInput,
  SendContactInput,
  SendFlowInput,
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
    profile: true,
    updateProfile: true,
    cloudAccount: true,
    flows: true,
    cloudGroups: true,
    calling: true,
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
    const version = (this.config.cloudApiVersion as string) ?? 'v26.0';
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

    for (const client of [this.http, this.mgmt]) {
      client.interceptors.response.use(undefined, (e: unknown) => {
        throw this.graphError(e);
      });
    }

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
      ...this.addr(to),
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
      ...this.addr(to),
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
      ...this.addr(to),
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
      ...this.addr(to),
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
      ...this.addr(to),
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
      ...this.addr(to),
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
      ...this.addr(to),
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
  async markRead(
    _chatId: string,
    messageIds?: string[],
    opts?: { typing?: boolean },
  ): Promise<void> {
    const ids = messageIds ?? [];
    for (const [i, id] of ids.entries()) {
      await this.http.post(`/${this.phoneNumberId}/messages`, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: id,
        // "digitando…" (até 25s ou até a resposta) — só na última mensagem.
        ...(opts?.typing && i === ids.length - 1 ? { typing_indicator: { type: 'text' } } : {}),
      });
    }
  }

  async blockContact(jid: string): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}/block_users`, {
      messaging_product: 'whatsapp',
      block_users: [this.blockRef(jid)],
    });
  }

  async unblockContact(jid: string): Promise<void> {
    await this.http.delete(`/${this.phoneNumberId}/block_users`, {
      data: { messaging_product: 'whatsapp', block_users: [this.blockRef(jid)] },
    });
  }

  private blockRef(jid: string): { user: string } | { user_id: string } {
    const v = this.toNumber(jid);
    return BSUID_RE.test(v) ? { user_id: v } : { user: v };
  }

  /** Pede a localização do usuário (interactive location_request_message). */
  async requestLocation(to: string, text: string): Promise<SendResult> {
    const num = this.toNumber(to);
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...this.addr(num),
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
    return this.paged<MessageTemplate>(`/${this.wabaId}/message_templates`, params);
  }

  /** Segue a paginação por cursor da Graph API (teto de segurança de 50 páginas). */
  private async paged<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
    const out: T[] = [];
    let after: string | undefined;
    for (let page = 0; page < 50; page++) {
      const res = await this.mgmt.get(path, { params: { ...params, ...(after ? { after } : {}) } });
      const body = res.data as {
        data?: T[];
        paging?: { cursors?: { after?: string }; next?: string };
      };
      out.push(...(body?.data ?? []));
      after = body?.paging?.next ? body.paging.cursors?.after : undefined;
      if (!after) break;
    }
    return out;
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

  /**
   * `route: marketing` usa a Marketing Messages API: mesmo corpo do template,
   * outro endpoint (`/marketing_messages`), só categoria MARKETING. É envio
   * unitário como qualquer outro — a otimização de entrega é da Meta.
   */
  async sendTemplate(input: SendTemplateInput): Promise<SendResult> {
    const to = this.toNumber(input.to);
    const marketing = input.route === 'marketing';
    const res = await this.http.post(
      `/${this.phoneNumberId}/${marketing ? 'marketing_messages' : 'messages'}`,
      {
        messaging_product: 'whatsapp',
        ...(marketing ? { recipient_type: 'individual' } : {}),
        ...this.addr(to),
        type: 'template',
        template: {
          name: input.name,
          language: { code: input.language },
          ...(input.components ? { components: input.components } : {}),
        },
        ...(marketing && input.productPolicy ? { product_policy: input.productPolicy } : {}),
        ...(marketing && input.messageActivitySharing != null
          ? { message_activity_sharing: input.messageActivitySharing }
          : {}),
        // a MM API é só de envio de template de marketing — sem reply/context.
        ...(marketing ? {} : this.context(input.quotedMessageId)),
      },
    );
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

  // ── perfil de negócio (messaging token, phoneNumberId) ──

  async getProfile(): Promise<ProfileInfo> {
    const res = await this.http.get(`/${this.phoneNumberId}/whatsapp_business_profile`, {
      params: { fields: 'about,address,description,email,profile_picture_url,websites,vertical' },
    });
    const p = ((res.data as { data?: Record<string, unknown>[] })?.data?.[0] ?? {}) as Record<
      string,
      unknown
    >;
    return {
      jid: this.phoneNumberId,
      status: p.about as string | undefined,
      profilePicUrl: p.profile_picture_url as string | undefined,
    };
  }

  async updateProfile(input: UpdateProfileInput): Promise<void> {
    const body: Record<string, unknown> = { messaging_product: 'whatsapp' };
    if (input.about != null) body.about = input.about;
    if (input.address != null) body.address = input.address;
    if (input.description != null) body.description = input.description;
    if (input.email != null) body.email = input.email;
    if (input.vertical != null) body.vertical = input.vertical;
    if (input.websites != null) body.websites = input.websites;
    if (input.profilePictureHandle != null) {
      body.profile_picture_handle = input.profilePictureHandle;
    }
    await this.http.post(`/${this.phoneNumberId}/whatsapp_business_profile`, body);
  }

  // ── conta/WABA (management token; onboarding usa messaging token) ──

  private readonly PHONE_FIELDS =
    'verified_name,display_phone_number,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput,platform_type,health_status,webhook_configuration';

  async listPhoneNumbers(): Promise<PhoneNumberInfo[]> {
    return this.paged<PhoneNumberInfo>(`/${this.wabaId}/phone_numbers`);
  }

  async getPhoneNumber(): Promise<PhoneNumberInfo> {
    const res = await this.mgmt.get(`/${this.phoneNumberId}`, {
      params: { fields: this.PHONE_FIELDS },
    });
    return { id: this.phoneNumberId, ...(res.data as object) } as PhoneNumberInfo;
  }

  async requestVerificationCode(input: RequestCodeInput): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}/request_code`, {
      code_method: input.codeMethod,
      language: input.language,
    });
  }

  async verifyCode(code: string): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}/verify_code`, { code });
  }

  async registerNumber(input: RegisterNumberInput): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}/register`, {
      messaging_product: 'whatsapp',
      pin: input.pin,
      ...(input.dataLocalizationRegion
        ? { data_localization_region: input.dataLocalizationRegion }
        : {}),
    });
  }

  async deregisterNumber(): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}/deregister`, {});
  }

  async setTwoStepPin(pin: string): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}`, { pin });
  }

  async getWabaInfo(): Promise<unknown> {
    const res = await this.mgmt.get(`/${this.wabaId}`, {
      params: {
        fields:
          'id,name,currency,timezone_id,account_review_status,business_verification_status,country,message_template_namespace,health_status',
      },
    });
    return res.data;
  }

  async subscribeApp(): Promise<unknown> {
    const res = await this.mgmt.post(`/${this.wabaId}/subscribed_apps`, {});
    return res.data;
  }

  async listSubscribedApps(): Promise<unknown> {
    const res = await this.mgmt.get(`/${this.wabaId}/subscribed_apps`);
    return res.data;
  }

  async unsubscribeApp(): Promise<void> {
    await this.mgmt.delete(`/${this.wabaId}/subscribed_apps`);
  }

  async messagingAnalytics(query: MessagingAnalyticsQuery): Promise<unknown> {
    const field =
      `analytics.start(${query.start}).end(${query.end}).granularity(${query.granularity ?? 'DAY'})` +
      (query.phoneNumbers?.length ? `.phone_numbers(${JSON.stringify(query.phoneNumbers)})` : '') +
      (query.productTypes?.length ? `.product_types(${JSON.stringify(query.productTypes)})` : '') +
      (query.countryCodes?.length ? `.country_codes(${JSON.stringify(query.countryCodes)})` : '');
    const res = await this.mgmt.get(`/${this.wabaId}`, { params: { fields: field } });
    return res.data;
  }

  /**
   * Substitui `conversation_analytics`, que a Meta desligou em 2026-11-01 com o
   * fim da cobrança por conversa (preço por mensagem desde 2025-07-01).
   */
  async pricingAnalytics(query: PricingAnalyticsQuery): Promise<unknown> {
    const list = (name: string, v?: string[]) =>
      v?.length ? `.${name}(${JSON.stringify(v)})` : '';
    const field =
      `pricing_analytics.start(${query.start}).end(${query.end}).granularity(${query.granularity ?? 'DAILY'})` +
      list('phone_numbers', query.phoneNumbers) +
      list('country_codes', query.countryCodes) +
      list('metric_types', query.metricTypes) +
      list('pricing_types', query.pricingTypes) +
      list('pricing_categories', query.pricingCategories) +
      list('dimensions', query.dimensions);
    const res = await this.mgmt.get(`/${this.wabaId}`, { params: { fields: field } });
    return res.data;
  }

  /**
   * Aponta o webhook DESTE número para a rota da instância no gateway
   * (override por número tem precedência sobre o da WABA e o do app). Webhooks
   * de template/conta continuam indo para a URL padrão do app.
   */
  async setWebhookOverride(input: { callbackUri: string; verifyToken: string }): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}`, {
      webhook_configuration: {
        override_callback_uri: input.callbackUri,
        verify_token: input.verifyToken,
      },
    });
  }

  async clearWebhookOverride(): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}`, {
      webhook_configuration: { override_callback_uri: '' },
    });
  }

  // ── WhatsApp Flows (management token; send = messaging token) ──

  private readonly FLOW_FIELDS =
    'id,name,status,categories,validation_errors,json_version,data_api_version,endpoint_uri,preview,whatsapp_business_account,application,health_status';

  async listFlows(): Promise<Flow[]> {
    return this.paged<Flow>(`/${this.wabaId}/flows`, {
      fields: 'id,name,status,categories,validation_errors',
      limit: '100',
    });
  }

  async getFlow(id: string): Promise<Flow> {
    const res = await this.mgmt.get(`/${id}`, { params: { fields: this.FLOW_FIELDS } });
    return res.data as Flow;
  }

  async createFlow(input: CreateFlowInput): Promise<CreateFlowResult> {
    const res = await this.mgmt.post(`/${this.wabaId}/flows`, {
      name: input.name,
      categories: input.categories,
      ...(input.flow_json ? { flow_json: input.flow_json } : {}),
      ...(input.clone_flow_id ? { clone_flow_id: input.clone_flow_id } : {}),
      ...(input.endpoint_uri ? { endpoint_uri: input.endpoint_uri } : {}),
      ...(input.publish != null ? { publish: input.publish } : {}),
    });
    const d = res.data as { id?: string; validation_errors?: unknown[] };
    return { id: d?.id ?? '', validation_errors: d?.validation_errors ?? [] };
  }

  /** Atualiza o flow.json via asset (multipart). Retorna validation_errors. */
  async updateFlowJson(id: string, flowJson: string): Promise<{ validation_errors: unknown[] }> {
    const form = new FormData();
    form.append('name', 'flow.json');
    form.append('asset_type', 'FLOW_JSON');
    form.append('file', Buffer.from(flowJson, 'utf8'), {
      filename: 'flow.json',
      contentType: 'application/json',
    });
    const res = await this.mgmt.post(`/${id}/assets`, form, { headers: form.getHeaders() });
    return {
      validation_errors: (res.data as { validation_errors?: unknown[] })?.validation_errors ?? [],
    };
  }

  async publishFlow(id: string): Promise<void> {
    await this.mgmt.post(`/${id}/publish`, {});
  }

  async deprecateFlow(id: string): Promise<void> {
    await this.mgmt.post(`/${id}/deprecate`, {});
  }

  async deleteFlow(id: string): Promise<void> {
    await this.mgmt.delete(`/${id}`);
  }

  async sendFlow(input: SendFlowInput): Promise<SendResult> {
    const to = this.toNumber(input.to);
    const action = input.action ?? 'navigate';
    const parameters: Record<string, unknown> = {
      flow_message_version: '3',
      flow_token: input.flowToken,
      flow_cta: input.cta,
      flow_action: action,
      ...(input.flowId ? { flow_id: input.flowId } : {}),
      ...(input.flowName ? { flow_name: input.flowName } : {}),
      ...(input.mode ? { mode: input.mode } : {}),
    };
    if (action === 'navigate') {
      parameters.flow_action_payload = {
        screen: input.screen,
        ...(input.data && Object.keys(input.data).length ? { data: input.data } : {}),
      };
    }
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...this.addr(to),
      type: 'interactive',
      interactive: {
        type: 'flow',
        ...(input.header ? { header: { type: 'text', text: input.header } } : {}),
        body: { text: input.body },
        ...(input.footer ? { footer: { text: input.footer } } : {}),
        action: { name: 'flow', parameters },
      },
      ...this.context(input.quotedMessageId),
    });
    return this.result(res.data, to);
  }

  /** Só em DRAFT (a Meta rejeita em Flow publicado — o erro dela é repassado). */
  async updateFlowMetadata(id: string, input: UpdateFlowMetadataInput): Promise<void> {
    await this.mgmt.post(`/${id}`, {
      ...(input.name ? { name: input.name } : {}),
      ...(input.categories?.length ? { categories: input.categories } : {}),
      ...(input.endpoint_uri != null ? { endpoint_uri: input.endpoint_uri } : {}),
      ...(input.application_id ? { application_id: input.application_id } : {}),
    });
  }

  async listFlowAssets(id: string): Promise<FlowAsset[]> {
    const res = await this.mgmt.get(`/${id}/assets`);
    return ((res.data as { data?: FlowAsset[] })?.data ?? []) as FlowAsset[];
  }

  /** Baixa o Flow JSON do asset (URL assinada e temporária do CDN da Meta). `null` se não houver. */
  async getFlowJson(id: string): Promise<string | null> {
    const assets = await this.listFlowAssets(id);
    const url = (assets.find((a) => a.asset_type === 'FLOW_JSON') ?? assets[0])?.download_url;
    if (!url) return null;
    const res = await axios.get<string>(url, {
      responseType: 'text',
      transformResponse: (d: unknown) => d, // mantém o texto cru (sem parse/reformatação)
      timeout: 20_000,
    });
    return res.data;
  }

  // ── Flows: criptografia do endpoint (chave por número) ──
  // A privada fica no SessionStore (mesma tabela das credenciais de sessão),
  // nunca em `instance.config` nem em resposta de API.

  private static readonly FLOW_KEY = 'flow_private_key';
  private static readonly FLOW_KEY_PASS = 'flow_private_key_passphrase';

  async getFlowEncryption(): Promise<FlowEncryptionInfo> {
    const res = await this.http.get(`/${this.phoneNumberId}/whatsapp_business_encryption`);
    // a Meta já documentou as duas formas: campos na raiz ou em `data[0]`.
    const raw = res.data as Record<string, unknown> & { data?: Record<string, string>[] };
    const d = (raw?.data?.[0] ?? raw ?? {}) as Record<string, string>;
    return {
      business_public_key: d.business_public_key,
      business_public_key_signature_status: d.business_public_key_signature_status,
      hasPrivateKey: !!(await this.sessionStore.get(this.instanceId, CloudApiProvider.FLOW_KEY)),
    };
  }

  /**
   * Registra a pública na Meta ANTES de trocar a privada local: se a Meta
   * recusar, a chave antiga (que ainda casa com a pública vigente) é mantida.
   */
  async setFlowEncryption(input: SetFlowEncryptionInput): Promise<FlowEncryptionInfo> {
    const pair = input.privateKey
      ? {
          privateKey: input.privateKey,
          publicKey: publicKeyFromPrivate(input.privateKey, input.passphrase),
        }
      : generateFlowKeyPair();
    const form = new URLSearchParams({ business_public_key: pair.publicKey });
    await this.http.post(`/${this.phoneNumberId}/whatsapp_business_encryption`, form.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    await this.sessionStore.set(this.instanceId, CloudApiProvider.FLOW_KEY, pair.privateKey);
    if (input.privateKey && input.passphrase) {
      await this.sessionStore.set(
        this.instanceId,
        CloudApiProvider.FLOW_KEY_PASS,
        input.passphrase,
      );
    } else {
      await this.sessionStore.remove(this.instanceId, CloudApiProvider.FLOW_KEY_PASS);
    }
    return this.getFlowEncryption();
  }

  /**
   * Endpoint de troca de dados. Códigos HTTP do protocolo da Meta:
   * 432 assinatura inválida · 421 não decifrável (o cliente rebaixa a chave
   * pública e tenta de novo) · 427 flow_token inválido · 200 com o corpo
   * cifrado em base64 (texto puro).
   */
  async handleFlowEndpoint(
    req: FlowEndpointHttpRequest,
    handlers: FlowEndpointHandlers,
  ): Promise<{ status: number; body: string }> {
    const secret = this.config.appSecret as string | undefined;
    if (secret && !verifySha256Signature(secret, req.rawBody, req.headers['x-hub-signature-256'])) {
      return { status: 432, body: '' };
    }
    if (!isEncryptedFlowRequest(req.body)) return { status: 400, body: '' };

    const privateKey = await this.sessionStore.get(this.instanceId, CloudApiProvider.FLOW_KEY);
    if (!privateKey) {
      this.logger.error(
        `[${this.instanceId}] endpoint de Flow chamado sem chave privada — configure flows/encryption`,
      );
      return { status: 421, body: '' };
    }
    const passphrase =
      (await this.sessionStore.get(this.instanceId, CloudApiProvider.FLOW_KEY_PASS)) ?? undefined;

    let dec;
    try {
      dec = decryptFlowRequest(req.body, privateKey, passphrase);
    } catch (e) {
      if (!(e instanceof FlowDecryptionError)) throw e;
      this.logger.warn(`[${this.instanceId}] Flow endpoint: ${e.message}`);
      return { status: 421, body: '' };
    }

    const body = dec.body as {
      version?: string;
      action?: string;
      screen?: string;
      data?: Record<string, unknown>;
      flow_token?: string;
      flow_token_signature?: string;
    };
    const reply = (payload: unknown) => ({
      status: 200,
      body: encryptFlowResponse(payload, dec.aesKey, dec.iv),
    });

    // health check periódico da Meta.
    if (body.action === 'ping') return reply({ data: { status: 'active' } });

    // notificação de erro: o cliente não conseguiu processar a resposta anterior.
    if (body.data && typeof body.data.error === 'string') {
      await handlers.onClientError?.(body.flow_token, body.data);
      return reply({ data: { acknowledged: true } });
    }

    try {
      return reply(
        await handlers.onExchange({
          version: body.version,
          action: body.action ?? '',
          screen: body.screen,
          data: body.data,
          flowToken: body.flow_token,
          ...(body.flow_token_signature ? { flowTokenSignature: body.flow_token_signature } : {}),
        }),
      );
    } catch (e) {
      if (e instanceof FlowTokenInvalidError) {
        return reply427(e.message, dec.aesKey, dec.iv);
      }
      throw e;
    }
  }

  // ── grupos da Cloud API (Groups API — exige OBA; máx. 8 participantes) ──
  // Caminhos conforme a referência atual da Meta: o grupo é um nó próprio
  // (`/{GROUP_ID}`), não um filho do número. ⚠️ Não validado contra conta real
  // (a Groups API exige Official Business Account).

  async listCloudGroups(): Promise<GroupInfo[]> {
    const res = await this.http.get(`/${this.phoneNumberId}/groups`);
    const body = res.data as { data?: { groups?: unknown[] } | unknown[] };
    const list = Array.isArray(body?.data) ? body.data : (body?.data?.groups ?? []);
    return (list as Record<string, unknown>[]).map((g) => this.toCloudGroup(g));
  }

  async getCloudGroup(groupId: string): Promise<GroupInfo> {
    const res = await this.http.get(`/${groupId}`);
    return this.toCloudGroup({ id: groupId, ...(res.data as Record<string, unknown>) });
  }

  /** Participantes entram pelo link de convite — a criação não aceita lista. */
  async createCloudGroup(input: { subject: string; description?: string }): Promise<GroupInfo> {
    const res = await this.http.post(`/${this.phoneNumberId}/groups`, {
      messaging_product: 'whatsapp',
      subject: input.subject,
      ...(input.description ? { description: input.description } : {}),
    });
    return this.toCloudGroup({ subject: input.subject, ...(res.data as Record<string, unknown>) });
  }

  async deleteCloudGroup(groupId: string): Promise<void> {
    await this.http.delete(`/${groupId}`);
  }

  async getCloudGroupInvite(groupId: string): Promise<{ code: string; url: string }> {
    const res = await this.http.get(`/${groupId}/invite_link`);
    return this.toInvite(res.data);
  }

  async resetCloudGroupInvite(groupId: string): Promise<{ code: string; url: string }> {
    const res = await this.http.post(`/${groupId}/invite_link`, { messaging_product: 'whatsapp' });
    return this.toInvite(res.data);
  }

  async removeCloudGroupParticipant(groupId: string, waId: string): Promise<void> {
    await this.http.delete(`/${groupId}/participants`, {
      data: { messaging_product: 'whatsapp', participants: [{ user: this.toNumber(waId) }] },
    });
  }

  private toInvite(data: unknown): { code: string; url: string } {
    const url = (data as { invite_link?: string })?.invite_link ?? '';
    return { code: url.split('/').pop() ?? '', url };
  }

  private toCloudGroup(g: Record<string, unknown>): GroupInfo {
    return {
      jid: (g.id as string) ?? (g.group_id as string) ?? '',
      subject: (g.subject as string) ?? (g.name as string) ?? '',
      description: g.description as string | undefined,
      participants: [],
      size: (g.size as number) ?? 0,
      inviteCode: g.invite_code as string | undefined,
    };
  }

  // ── calling (só sinalização; mídia WebRTC é externa ao gateway) ──

  async configureCalling(settings: unknown): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}/settings`, { calling: settings });
  }

  async getCallingSettings(): Promise<unknown> {
    const res = await this.http.get(`/${this.phoneNumberId}/settings`);
    return res.data;
  }

  /** Pede permissão de chamada (interactive call_permission_request, janela 24h). */
  async requestCallPermission(to: string, text?: string): Promise<SendResult> {
    const num = this.toNumber(to);
    const res = await this.http.post(`/${this.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      ...this.addr(num),
      type: 'interactive',
      interactive: {
        type: 'call_permission_request',
        action: { name: 'call_permission_request' },
        ...(text ? { body: { text } } : {}),
      },
    });
    return this.result(res.data, num);
  }

  async getCallPermission(waId: string): Promise<unknown> {
    const res = await this.http.get(`/${this.phoneNumberId}/call_permissions`, {
      params: { user_wa_id: this.toNumber(waId) },
    });
    return res.data;
  }

  /** connect/pre_accept/accept/reject/terminate — o SDP trafega no payload. */
  async connectCall(input: ConnectCallInput): Promise<{ id?: string }> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      action: input.action,
    };
    if (input.to) body.to = this.toNumber(input.to);
    if (input.callId) body.call_id = input.callId;
    if (input.sdp) body.session = { sdp_type: input.sdp.type, sdp: input.sdp.sdp };
    if (input.callbackData) body.biz_opaque_callback_data = input.callbackData;
    const res = await this.http.post(`/${this.phoneNumberId}/calls`, body);
    const id = (res.data as { calls?: { id?: string }[] })?.calls?.[0]?.id;
    return { id };
  }

  private handleCallsChange(value?: { calls?: Record<string, unknown>[] }): void {
    for (const call of value?.calls ?? []) {
      const event = call.event as string | undefined;
      this.emitWebhook(
        event === 'terminate' ? WebhookEvent.CALL_TERMINATE : WebhookEvent.CALL_CONNECT,
        call,
      );
    }
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
   * Converte a falha da Graph API em erro canônico, preservando o diagnóstico
   * da Meta (`code`, `error_subcode`, `error_user_msg`, `error_data`,
   * `fbtrace_id`). 401/403 da Meta são problema de credencial DA INSTÂNCIA, não
   * do chamador — viram 502 pra não se confundir com apikey inválida.
   */
  private graphError(e: unknown): Error {
    if (!axios.isAxiosError(e)) return e as Error;
    const upstream = e.response?.status;
    const ge = (e.response?.data as { error?: GraphErrorBody } | undefined)?.error;
    if (!e.response) {
      return new ProviderRequestError(
        `Cloud API inacessível: ${e.message}`,
        502,
        'upstreamUnreachable',
        this.type,
      );
    }
    const status =
      upstream === 429
        ? 429
        : upstream === 400 || upstream === 404
          ? upstream
          : upstream && upstream < 500 && upstream !== 401 && upstream !== 403
            ? 422
            : 502;
    return new ProviderRequestError(
      ge?.error_user_msg || ge?.message || `Cloud API respondeu HTTP ${upstream}`,
      status,
      ge?.code ?? `http_${upstream}`,
      this.type,
      {
        upstreamStatus: upstream,
        ...(ge?.type ? { type: ge.type } : {}),
        ...(ge?.error_subcode != null ? { error_subcode: ge.error_subcode } : {}),
        ...(ge?.error_user_title ? { error_user_title: ge.error_user_title } : {}),
        ...(ge?.error_user_msg ? { error_user_msg: ge.error_user_msg } : {}),
        ...(ge?.error_data ? { error_data: ge.error_data } : {}),
        ...(ge?.message ? { message: ge.message } : {}),
        ...(ge?.fbtrace_id ? { fbtrace_id: ge.fbtrace_id } : {}),
      },
    );
  }

  private warnedNoAppSecret = false;

  /**
   * Valida `X-Hub-Signature-256` (HMAC-SHA256 do corpo cru com o App Secret).
   * Sem `appSecret` configurado não há como validar: aceita, mas avisa — a rota
   * é pública e o id da instância é o único segredo nesse caso.
   */
  verifyInboundWebhook(meta: InboundWebhookMeta): boolean {
    const secret = this.config.appSecret as string | undefined;
    if (!secret) {
      if (!this.warnedNoAppSecret) {
        this.warnedNoAppSecret = true;
        this.logger.warn(
          `[${this.instanceId}] Cloud API sem appSecret (CLOUD_API_APP_SECRET / config.appSecret): ` +
            'webhooks de entrada NÃO estão sendo autenticados.',
        );
      }
      return true;
    }
    return verifySha256Signature(secret, meta.rawBody, meta.headers['x-hub-signature-256']);
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
          case 'group_participants_update':
            this.emitWebhook(WebhookEvent.GROUP_PARTICIPANTS_UPDATE, change.value);
            break;
          case 'group_lifecycle_update':
          case 'group_settings_update':
          case 'group_status_update':
            this.emitWebhook(WebhookEvent.GROUPS_UPDATE, change.value);
            break;
          case 'flows':
            this.emitWebhook(WebhookEvent.FLOW_STATUS_UPDATE, change.value);
            break;
          case 'smb_message_echoes':
            this.handleEchoes(change.value);
            break;
          case 'account_update':
          case 'account_alerts':
          case 'account_review_update':
          case 'business_capability_update':
          case 'phone_number_quality_update':
          case 'phone_number_name_update':
          case 'security':
          case 'user_preferences':
          case 'message_template_components_update':
          case 'business_username_updates':
          case 'payment_configuration_update':
            // cauda longa de conta/número: repassa com o nome do campo da Meta.
            this.emitWebhook(WebhookEvent.ACCOUNT_UPDATE, {
              field: change.field,
              value: change.value,
            });
            break;
          case 'calls':
            this.handleCallsChange(change.value as { calls?: Record<string, unknown>[] });
            break;
          case 'account_settings_update':
            this.emitWebhook(WebhookEvent.CALL_SETTINGS_UPDATE, change.value);
            break;
          default:
            this.logger.debug(`[cloud] webhook field não tratado: ${change.field}`);
        }
      }
    }
  }

  // ── webhook: handlers por field ──────────────────────────────

  /** `messages[]` (inbound) + `statuses[]` (sent/delivered/read/played/failed) no mesmo value. */
  private handleMessagesChange(value?: CloudChangeValue): void {
    const contact = value?.contacts?.[0];
    for (const msg of value?.messages ?? []) {
      try {
        this.handleInboundMessage(msg, contact);
      } catch (e) {
        // uma mensagem malformada não pode derrubar o resto do lote.
        this.logger.error(`[cloud] mensagem ${msg?.id} não normalizada: ${(e as Error).message}`);
      }
    }
    for (const st of value?.statuses ?? []) {
      const status = this.mapStatus(st.status);
      if (!status) {
        this.logger.debug(`[cloud] status desconhecido ignorado: ${st.status}`);
        continue;
      }
      const err = st.errors?.[0];
      this.emitTyped('message.status', {
        provider: this.type,
        instanceId: this.instanceId,
        messageId: st.id,
        // BSUID: `recipient_id` (telefone) pode vir omitido.
        chatId: st.recipient_id ?? st.recipient_user_id ?? '',
        status,
        timestamp: Number(st.timestamp ?? 0),
        ...(err
          ? {
              error: {
                code: err.code,
                title: err.title,
                message: err.message,
                ...(err.error_data?.details ? { details: err.error_data.details } : {}),
              },
            }
          : {}),
        ...(st.pricing ? { pricing: st.pricing } : {}),
        ...(st.biz_opaque_callback_data ? { callbackData: st.biz_opaque_callback_data } : {}),
      });
    }
    // erros de nível de conta/número (fora de uma mensagem específica).
    for (const e of value?.errors ?? []) {
      this.emitWebhook(WebhookEvent.ERROR, {
        message: e.message ?? e.title,
        code: e.code,
        details: e.error_data?.details,
      });
    }
  }

  /** Roteia UMA mensagem inbound: reação/edição/exclusão têm evento próprio. */
  private handleInboundMessage(msg: CloudMessage, contact?: CloudContact): void {
    const from = msg.from ?? msg.from_user_id ?? '';
    const chatId = msg.group_id ?? from;
    const ts = Number(msg.timestamp ?? 0);

    if (msg.type === 'interactive' && msg.interactive?.type === 'call_permission_reply') {
      this.emitWebhook(WebhookEvent.CALL_PERMISSION_REPLY, msg);
      return;
    }
    if (msg.type === 'reaction' && msg.reaction?.message_id) {
      this.emitWebhook(WebhookEvent.MESSAGE_REACTION, {
        provider: this.type,
        instanceId: this.instanceId,
        messageId: msg.reaction.message_id,
        chatId,
        from,
        fromMe: false,
        emoji: msg.reaction.emoji ?? '', // vazio = reação removida
        timestamp: ts,
      } satisfies NormalizedReaction);
      return;
    }
    // edição/exclusão feitas pelo usuário (coexistência com o app Business).
    if (msg.type === 'revoke') {
      this.emitWebhook(WebhookEvent.MESSAGE_DELETED, {
        provider: this.type,
        instanceId: this.instanceId,
        messageId: msg.revoke?.original_message_id ?? msg.id,
        chatId,
        fromMe: false,
        timestamp: ts,
      } satisfies NormalizedDeletion);
      return;
    }
    if (msg.type === 'edit') {
      this.emitWebhook(WebhookEvent.MESSAGE_EDITED, {
        provider: this.type,
        instanceId: this.instanceId,
        messageId: msg.edit?.original_message_id ?? msg.id,
        chatId,
        from,
        fromMe: false,
        text: msg.edit?.message?.text?.body ?? msg.text?.body ?? '',
        timestamp: ts,
      } satisfies NormalizedEdit);
      return;
    }
    this.emitTyped('message', this.normalize(msg, contact));
  }

  /**
   * Coexistência: mensagens enviadas pelo app WhatsApp Business do mesmo
   * número chegam como eco — viram `message.sent`, com o chat no destinatário.
   */
  private handleEchoes(value?: CloudChangeValue): void {
    for (const msg of value?.message_echoes ?? []) {
      const to = msg.to ?? msg.to_user_id ?? '';
      this.emitWebhook(WebhookEvent.MESSAGE_SENT, {
        ...this.normalize(msg),
        chatId: msg.group_id ?? to,
        fromMe: true,
      });
    }
  }

  // ── helpers ───────────────────────────────────────────────

  /**
   * Destinatário como a Cloud espera: dígitos do telefone, ou o BSUID
   * (Business-Scoped User ID, ex.: `US.1349…`) intacto — a Meta pode entregar
   * só o BSUID quando o usuário não expõe o número.
   */
  private toNumber(to: string): string {
    const v = to.trim();
    return BSUID_RE.test(v) ? v : v.replace(/\D/g, '');
  }

  /** Campo de destino do envio: `to` (telefone) ou `recipient` (BSUID). */
  private addr(to: string): { to: string } | { recipient: string } {
    return BSUID_RE.test(to) ? { recipient: to } : { to };
  }

  /** Envelope `context` para reply/quote (mesmo formato em todos os tipos). */
  private context(quotedMessageId?: string): Record<string, unknown> {
    return quotedMessageId ? { context: { message_id: quotedMessageId } } : {};
  }

  private mapStatus(s?: string): MessageAckStatus | undefined {
    switch (s) {
      case 'sent':
        return MessageAckStatus.SERVER;
      case 'delivered':
        return MessageAckStatus.DELIVERED;
      case 'read':
        return MessageAckStatus.READ;
      case 'played':
        return MessageAckStatus.PLAYED;
      case 'failed':
        return MessageAckStatus.FAILED;
      default:
        // status novo/desconhecido: ignorar — nunca rebaixar o ack para pending.
        return undefined;
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

  private normalize(msg: CloudMessage, contact?: CloudContact): NormalizedMessage {
    let type = MessageType.UNKNOWN;
    let text: string | undefined;
    let media: NormalizedMessage['media'];
    let location: NormalizedMessage['location'];
    let flowResponse: FlowResponse | undefined;
    let interactiveReply: NormalizedMessage['interactiveReply'];
    let contacts: NormalizedMessage['contacts'];
    let order: NormalizedMessage['order'];

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
        text = msg.video?.caption;
        media = { mimetype: msg.video?.mime_type, caption: text };
        break;
      case 'audio':
        type = MessageType.AUDIO;
        media = { mimetype: msg.audio?.mime_type, ...(msg.audio?.voice ? { isPtt: true } : {}) };
        break;
      case 'document':
        type = MessageType.DOCUMENT;
        text = msg.document?.caption;
        media = {
          mimetype: msg.document?.mime_type,
          filename: msg.document?.filename,
          caption: text,
        };
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
      case 'contacts':
        type = MessageType.CONTACT;
        contacts = (msg.contacts ?? []).map((c) => ({
          name: c.name?.formatted_name,
          phones: (c.phones ?? []).map((p) => p.wa_id ?? p.phone ?? '').filter(Boolean),
        }));
        text =
          contacts
            .map((c) => c.name)
            .filter(Boolean)
            .join(', ') || undefined;
        break;
      case 'interactive': {
        // resposta de botão/lista/flow — o texto vira o título/valor selecionado.
        type = MessageType.INTERACTIVE;
        const i = msg.interactive;
        text = i?.button_reply?.title ?? i?.list_reply?.title ?? i?.nfm_reply?.body;
        if (i?.button_reply) interactiveReply = { type: 'button', ...i.button_reply };
        else if (i?.list_reply) interactiveReply = { type: 'list', ...i.list_reply };
        if (i?.nfm_reply) flowResponse = parseNfmReply(i.nfm_reply);
        break;
      }
      case 'button':
        // quick-reply de TEMPLATE (diferente de interactive.button_reply).
        type = MessageType.INTERACTIVE;
        text = msg.button?.text;
        interactiveReply = {
          type: 'template_button',
          id: msg.button?.payload,
          title: msg.button?.text,
        };
        break;
      case 'order':
        type = MessageType.ORDER;
        order = msg.order;
        text = msg.order?.text as string | undefined;
        break;
      case 'system':
        // ex.: user_changed_number / user_changed_user_id — detalhes em `raw`.
        type = MessageType.SYSTEM;
        text = msg.system?.body;
        break;
      case 'unsupported':
        // a Meta informa o tipo original que a Cloud API não entrega.
        text = msg.unsupported?.type ? `[não suportado: ${msg.unsupported.type}]` : undefined;
        break;
    }

    // BSUID: `from` (telefone) pode vir omitido — cai no id com escopo de negócio.
    const from = msg.from ?? msg.from_user_id ?? '';
    const userId = msg.from_user_id ?? contact?.user_id;
    const ref = msg.referral;
    return {
      provider: this.type,
      instanceId: this.instanceId,
      id: msg.id,
      chatId: msg.group_id ?? from,
      from,
      fromMe: false,
      pushName: contact?.profile?.name,
      isGroup: !!msg.group_id,
      timestamp: Number(msg.timestamp ?? 0),
      type,
      text,
      media,
      location,
      ...(flowResponse ? { flowResponse } : {}),
      ...(interactiveReply ? { interactiveReply } : {}),
      ...(contacts ? { contacts } : {}),
      ...(order ? { order } : {}),
      ...(msg.context?.id ? { quotedMessageId: msg.context.id } : {}),
      ...(msg.context?.from ? { quotedParticipant: msg.context.from } : {}),
      ...(msg.context?.forwarded || msg.context?.frequently_forwarded ? { forwarded: true } : {}),
      ...(ref
        ? {
            referral: {
              sourceUrl: ref.source_url,
              sourceId: ref.source_id,
              sourceType: ref.source_type,
              headline: ref.headline,
              body: ref.body,
              mediaType: ref.media_type,
              ctwaClid: ref.ctwa_clid,
            },
          }
        : {}),
      ...(msg.from || userId
        ? {
            identity: {
              ...(msg.from ? { phone: msg.from } : {}),
              ...(userId ? { userId } : {}),
              ...(contact?.profile?.username ? { username: contact.profile.username } : {}),
              primary: 'pn' as const,
            },
          }
        : {}),
      raw: msg,
    };
  }
}

/** 427: a Meta mostra `error_msg` ao usuário e encerra o Flow. */
function reply427(message: string, aesKey: Buffer, iv: Buffer): { status: number; body: string } {
  return { status: 427, body: encryptFlowResponse({ error_msg: message }, aesKey, iv) };
}

/** Business-Scoped User ID: `<PAÍS>.<id>` ou `<PAÍS>.ENT.<id>` (id pai). */
const BSUID_RE = /^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9]{6,128}$/;

// ── tipos parciais do payload da Meta ────────────────────────
interface GraphErrorBody {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  error_user_title?: string;
  error_user_msg?: string;
  error_data?: unknown;
  fbtrace_id?: string;
}
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
  /** telefone do remetente — pode vir OMITIDO (BSUID). */
  from?: string;
  from_user_id?: string;
  /** só em ecos (coexistência). */
  to?: string;
  to_user_id?: string;
  /** mensagens de grupo (Groups API). */
  group_id?: string;
  timestamp?: string;
  type: string;
  text?: { body: string };
  image?: CloudMediaRef;
  video?: CloudMediaRef;
  audio?: CloudMediaRef & { voice?: boolean };
  document?: CloudMediaRef;
  sticker?: CloudMediaRef;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  contacts?: {
    name?: { formatted_name?: string };
    phones?: { phone?: string; wa_id?: string }[];
  }[];
  reaction?: { message_id?: string; emoji?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
    nfm_reply?: { name?: string; body?: string; response_json?: string };
  };
  button?: { text?: string; payload?: string };
  order?: Record<string, unknown>;
  system?: { body?: string; type?: string };
  unsupported?: { type?: string };
  edit?: { original_message_id?: string; message?: { text?: { body?: string } } };
  revoke?: { original_message_id?: string };
  context?: { id?: string; from?: string; forwarded?: boolean; frequently_forwarded?: boolean };
  referral?: {
    source_url?: string;
    source_id?: string;
    source_type?: string;
    headline?: string;
    body?: string;
    media_type?: string;
    ctwa_clid?: string;
  };
}
interface CloudError {
  code?: number;
  title?: string;
  message?: string;
  error_data?: { details?: string };
}
interface CloudStatus {
  id: string;
  status?: string;
  timestamp?: string;
  /** telefone do destinatário — pode vir OMITIDO (envio para BSUID). */
  recipient_id?: string;
  recipient_user_id?: string;
  errors?: CloudError[];
  pricing?: Record<string, unknown>;
  biz_opaque_callback_data?: string;
}
interface CloudContact {
  profile?: { name?: string; username?: string };
  wa_id?: string;
  user_id?: string;
}
interface CloudChangeValue {
  contacts?: CloudContact[];
  messages?: CloudMessage[];
  statuses?: CloudStatus[];
  message_echoes?: CloudMessage[];
  errors?: CloudError[];
}
interface CloudWebhookBody {
  entry?: {
    changes?: { field?: string; value?: CloudChangeValue }[];
  }[];
}
