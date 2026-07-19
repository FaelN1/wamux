import axios, { AxiosInstance } from 'axios';
import FormData from 'form-data';
import { Readable } from 'node:stream';
import { BaseProvider, ProviderContext } from '../provider.interface';
import {
  ConnectCallInput,
  ConnectionStatus,
  ConversationAnalyticsQuery,
  CreateFlowInput,
  CreateFlowResult,
  CreateTemplateInput,
  CreateTemplateResult,
  DeleteTemplateInput,
  EditTemplatePatch,
  Flow,
  FlowMetricsQuery,
  GroupInfo,
  MessageAckStatus,
  MessageTemplate,
  MessagingAnalyticsQuery,
  MessageType,
  NormalizedMessage,
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
    'verified_name,display_phone_number,quality_rating,code_verification_status,name_status,messaging_limit_tier,throughput,platform_type';

  async listPhoneNumbers(): Promise<PhoneNumberInfo[]> {
    const res = await this.mgmt.get(`/${this.wabaId}/phone_numbers`);
    return ((res.data as { data?: PhoneNumberInfo[] })?.data ?? []) as PhoneNumberInfo[];
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
          'id,name,currency,timezone_id,account_review_status,business_verification_status,country,message_template_namespace',
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

  async conversationAnalytics(query: ConversationAnalyticsQuery): Promise<unknown> {
    const field =
      `conversation_analytics.start(${query.start}).end(${query.end}).granularity(${query.granularity ?? 'DAILY'})` +
      (query.metricTypes?.length ? `.metric_types(${JSON.stringify(query.metricTypes)})` : '') +
      (query.conversationCategories?.length
        ? `.conversation_categories(${JSON.stringify(query.conversationCategories)})`
        : '') +
      (query.dimensions?.length ? `.dimensions(${JSON.stringify(query.dimensions)})` : '');
    const res = await this.mgmt.get(`/${this.wabaId}`, { params: { fields: field } });
    return res.data;
  }

  // ── WhatsApp Flows (management token; send = messaging token) ──

  private readonly FLOW_FIELDS = 'id,name,status,categories,validation_errors,preview,endpoint_uri';

  async listFlows(): Promise<Flow[]> {
    const res = await this.mgmt.get(`/${this.wabaId}/flows`);
    return ((res.data as { data?: Flow[] })?.data ?? []) as Flow[];
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
      to,
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

  async flowMetrics(id: string, query: FlowMetricsQuery): Promise<unknown> {
    const field =
      `metric.name(${query.metric}).granularity(${query.granularity})` +
      (query.since ? `.since(${query.since})` : '') +
      (query.until ? `.until(${query.until})` : '');
    const res = await this.mgmt.get(`/${id}`, { params: { fields: field } });
    return res.data;
  }

  // ── grupos da Cloud API (Groups API — OBA-gated, máx 8 participantes) ──
  // ⚠️ BODIES NÃO VALIDADOS contra conta real: as páginas get-started/reference
  // só deram resumo de capacidade, não os JSON literais. Padrão observado:
  // POST /{PHONE_NUMBER_ID}/groups. Confirmar create/participants/invite antes
  // de produção — ver docs/cloud-api/05-groups.md.

  async listCloudGroups(): Promise<GroupInfo[]> {
    const res = await this.http.get(`/${this.phoneNumberId}/groups`);
    return (((res.data as { data?: unknown[] })?.data ?? []) as Record<string, unknown>[]).map(
      (g) => this.toCloudGroup(g),
    );
  }

  async getCloudGroup(groupId: string): Promise<GroupInfo> {
    const res = await this.http.get(`/${this.phoneNumberId}/groups/${groupId}`);
    return this.toCloudGroup(res.data as Record<string, unknown>);
  }

  async createCloudGroup(input: { subject: string; participants?: string[] }): Promise<GroupInfo> {
    const res = await this.http.post(`/${this.phoneNumberId}/groups`, {
      messaging_product: 'whatsapp',
      subject: input.subject,
      ...(input.participants?.length
        ? { participants: input.participants.map((p) => ({ user: this.toNumber(p) })) }
        : {}),
    });
    return this.toCloudGroup(res.data as Record<string, unknown>);
  }

  async deleteCloudGroup(groupId: string): Promise<void> {
    await this.http.delete(`/${this.phoneNumberId}/groups/${groupId}`);
  }

  async getCloudGroupInvite(groupId: string): Promise<{ code: string; url: string }> {
    const res = await this.http.get(`/${this.phoneNumberId}/groups/${groupId}/invite`);
    const code = (res.data as { invite_code?: string })?.invite_code ?? '';
    return { code, url: code ? `https://chat.whatsapp.com/${code}` : '' };
  }

  async resetCloudGroupInvite(groupId: string): Promise<{ code: string; url: string }> {
    const res = await this.http.post(`/${this.phoneNumberId}/groups/${groupId}/invite`, {
      messaging_product: 'whatsapp',
    });
    const code = (res.data as { invite_code?: string })?.invite_code ?? '';
    return { code, url: code ? `https://chat.whatsapp.com/${code}` : '' };
  }

  async removeCloudGroupParticipant(groupId: string, waId: string): Promise<void> {
    await this.http.post(`/${this.phoneNumberId}/groups/${groupId}/participants`, {
      messaging_product: 'whatsapp',
      action: 'remove',
      participants: [{ user: this.toNumber(waId) }],
    });
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
      to: num,
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

  /** `messages[]` (inbound) + `statuses[]` (sent/delivered/read/failed) no mesmo value. */
  private handleMessagesChange(value?: CloudChangeValue): void {
    const contactName = value?.contacts?.[0]?.profile?.name;
    for (const msg of value?.messages ?? []) {
      // resposta de permissão de chamada chega como interactive sob messages.
      if (msg.type === 'interactive' && msg.interactive?.type === 'call_permission_reply') {
        this.emitWebhook(WebhookEvent.CALL_PERMISSION_REPLY, msg);
        continue;
      }
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
