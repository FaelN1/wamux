import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import {
  ConnectionStatus,
  ConnectionUpdate,
  FetchMessagesOptions,
  FetchMessagesPage,
  HistoryBatch,
  HistoryCursor,
  Identity,
  IdentityMode,
  Label,
  LabelTarget,
  MessageStatusUpdate,
  NewsletterInfo,
  CreateNewsletterInput,
  GroupInfo,
  CreateGroupInput,
  GroupParticipantAction,
  GroupParticipantResult,
  GroupSetting,
  CommunityInfo,
  CreateCommunityInput,
  CommunityAdminAction,
  CommunityLinkedGroup,
  CommunityParticipant,
  CommunityInviteProbeResult,
  UpdateCommunityImageInput,
  ProfileInfo,
  UpdateOwnProfileInput,
  NormalizedMessage,
  NumberCheckResult,
  PollResults,
  PollVoteUpdate,
  PortableCredentials,
  PresenceInfo,
  DeleteMessageInput,
  EditMessageInput,
  MessageTemplate,
  CreateTemplateInput,
  CreateTemplateResult,
  EditTemplatePatch,
  DeleteTemplateInput,
  TemplateFilter,
  SendTemplateInput,
  TemplateAnalyticsQuery,
  UpdateProfileInput,
  PhoneNumberInfo,
  RequestCodeInput,
  RegisterNumberInput,
  MessagingAnalyticsQuery,
  PricingAnalyticsQuery,
  Flow,
  CreateFlowInput,
  CreateFlowResult,
  SendFlowInput,
  FlowAsset,
  FlowDataExchangeRequest,
  FlowEncryptionInfo,
  SetFlowEncryptionInput,
  UpdateFlowMetadataInput,
  ConnectCallInput,
  ProviderCapabilities,
  ProviderType,
  ReactMessageInput,
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
  SessionStore,
  SetPresenceInput,
  UpsertLabelInput,
  WebhookEvent,
} from './provider.types';

/** Passagem genérica para os eventos de webhook da "cauda longa" (chats,
 * grupos, contatos, presença, chamada, etiquetas…) que não têm um evento
 * tipado próprio. O provider emite; o manager despacha direto pro webhook. */
export interface WebhookPassthrough {
  instanceId: string;
  provider: ProviderType;
  event: WebhookEvent;
  payload: unknown;
}

/** Eventos emitidos por qualquer provider (tipados). */
export interface ProviderEventMap {
  connection: ConnectionUpdate;
  message: NormalizedMessage;
  'message.status': MessageStatusUpdate;
  error: { instanceId: string; provider: ProviderType; error: Error };
  webhook: WebhookPassthrough;
  /** voto de enquete normalizado. */
  'poll.vote': PollVoteUpdate;
  /** lote de histórico da sincronização assíncrona. */
  history: HistoryBatch;
}

/**
 * Resolução de identidade LID ↔ PN-JID. Implementada pelo
 * IdentityService e injetada nos adapters via ProviderContext — mesma
 * mecânica do SessionStore.
 */
export interface IdentityResolver {
  /** Aprende/atualiza um par visto num evento da lib (upsert idempotente). */
  learn(instanceId: string, seen: Partial<Identity>): Promise<Identity>;
  /** Resolve a identidade canônica a partir de qualquer identificador. */
  resolve(
    instanceId: string,
    ref: { lid?: string; pnJid?: string; phone?: string },
  ): Promise<Identity>;
  /** Chave de dedup canônica (prefere lid). */
  dedupKey(id: Identity): string;
  /** remoteJid a expor ao cliente conforme a política da instância. */
  present(id: Identity, mode: IdentityMode): string;
}

/** Retorno do QR — ampliado com metadados do loop guard. */
export interface QrPayload {
  qr: string;
  qrImage: string;
  /** nº de QRs gerados nesta sessão de pareamento. */
  qrAttempts?: number;
  /** epoch (ms) em que este QR expira. */
  expiresAt?: number;
}

/**
 * Cache chave-valor (string → string) com TTL, agnóstico de engine e JÁ
 * namespaced por instância por quem monta o contexto (`ProviderFactory`): o
 * adapter usa chaves curtas (`sent:<id>`) e nunca enxerga as de outra
 * instância. Serve para estado efêmero que precisa atravessar restart do
 * processo/migração de worker sem virar tabela (ex.: o store de retry do
 * Baileys). Não é fonte de verdade: tudo aqui pode sumir a qualquer momento.
 *
 * As operações PODEM rejeitar (backend fora do ar) — quem usa trata a falha
 * como miss e segue; uma falha de cache nunca pode derrubar um envio.
 */
export interface ProviderCache {
  /** `null` = não existe (ou já expirou). */
  get(key: string): Promise<string | null>;
  /** Grava com validade em segundos (`ttlSec` > 0). */
  set(key: string, value: string, ttlSec: number): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Remove as chaves DESTA instância que começam com `prefix` (sem prefixo =
   * todas). Usado no logout, quando o que está em cache pertence a uma sessão
   * descartada.
   */
  clear(prefix?: string): Promise<void>;
}

/** Dados injetados na construção de um provider. */
export interface ProviderContext {
  instanceId: string;
  /**
   * Config específica do provider (ex.: Cloud API → { phoneNumberId, token };
   * whatsmeow → { userToken }). Vem do registro da instância.
   */
  config: Record<string, unknown>;
  sessionStore: SessionStore;
  logger: Logger;
  /** resolução LID↔PN. Opcional até todos os call-sites migrarem. */
  identity?: IdentityResolver;
  /** política de exposição do remoteJid. Default 'auto'. */
  identityMode?: IdentityMode;
  /**
   * Cache efêmero compartilhado entre workers (Redis), já namespaced por
   * instância. Opcional: sem ele o adapter funciona só com memória.
   */
  cache?: ProviderCache;
}

/**
 * Dados da requisição HTTP de um webhook de ENTRADA, repassados ao adapter
 * para que ELE autentique a origem (cada fonte assina de um jeito).
 */
export interface InboundWebhookMeta {
  /** headers HTTP (chaves em minúsculas, como o Node entrega). */
  headers: Record<string, string | string[] | undefined>;
  /** corpo cru (bytes) — base do HMAC. `undefined` se não foi capturado. */
  rawBody?: Buffer;
}

/** Requisição HTTP crua que chegou ao endpoint de troca de dados de um Flow. */
export interface FlowEndpointHttpRequest extends InboundWebhookMeta {
  body: unknown;
}

/**
 * Callbacks de negócio do endpoint de Flow. O adapter cuida do protocolo
 * (assinatura, criptografia, ping, notificação de erro); o serviço só decide
 * a próxima tela e registra a execução.
 */
export interface FlowEndpointHandlers {
  /** INIT / BACK / data_exchange → corpo da resposta (próxima tela ou conclusão). */
  onExchange(req: Omit<FlowDataExchangeRequest, 'instanceId'>): Promise<Record<string, unknown>>;
  /** O cliente WhatsApp reportou um erro ao processar a resposta anterior. */
  onClientError?(flowToken: string | undefined, error: Record<string, unknown>): Promise<void>;
}

/** Lançado por `onExchange` quando o flow_token é inválido/expirado (→ HTTP 427 para a Meta). */
export class FlowTokenInvalidError extends Error {
  constructor(message = 'flow_token inválido ou expirado') {
    super(message);
    this.name = 'FlowTokenInvalidError';
  }
}

/**
 * Erro devolvido pela FONTE da engine (Graph API da Meta, sidecar…) numa
 * chamada feita em nome do cliente. Canônico: o filtro HTTP global o converte
 * em resposta com `status` e expõe `code`/`details` — em vez de um 500 opaco.
 */
export class ProviderRequestError extends Error {
  constructor(
    message: string,
    /** status HTTP a devolver ao cliente do gateway. */
    readonly status: number,
    /** código estável do erro (o da fonte, quando existe). */
    readonly code: string | number,
    readonly provider: ProviderType,
    /** detalhes da fonte (subcódigo, mensagem ao usuário, id de rastreio…). */
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProviderRequestError';
  }
}

/** Lançado quando a engine não entrega o recurso interativo pedido (→ HTTP 422). */
export class InteractiveUnsupportedError extends Error {
  readonly code = 'interactiveUnsupported';
  constructor(
    readonly feature: keyof ProviderCapabilities,
    readonly provider: ProviderType,
  ) {
    super(`Recurso "${feature}" não é suportado pela engine ${provider}`);
  }
}

/**
 * Contrato que todo adapter de WhatsApp precisa implementar.
 * O resto do sistema (instâncias, mensagens, webhooks) só depende disto.
 *
 * Métodos com `?` são OPCIONAIS e gated por `capabilities` — o serviço
 * responde 501 (NotImplemented) uniforme quando a engine não suporta.
 */
export interface WhatsAppProvider {
  readonly type: ProviderType;
  readonly instanceId: string;

  /** O que este adapter suporta além do núcleo. Default = {} (nada extra). */
  readonly capabilities: ProviderCapabilities;

  /** Conecta / restaura a sessão persistida. Idempotente. */
  initialize(): Promise<void>;

  getStatus(): ConnectionStatus;

  /**
   * Retorna o QR atual (quando aplicável) para pareamento.
   * `null` quando o provider não usa QR (Cloud API) ou já está conectado.
   */
  getQRCode(): Promise<QrPayload | null>;

  sendText(input: SendTextInput): Promise<SendResult>;
  sendMedia(input: SendMediaInput): Promise<SendResult>;

  // ── interativos — defaults conservadores na BaseProvider ──
  sendPoll(input: SendPollInput): Promise<SendResult>;
  sendButtons(input: SendButtonsInput): Promise<SendResult>;
  sendList(input: SendListInput): Promise<SendResult>;
  sendPix(input: SendPixInput): Promise<SendResult>;
  /** Resultado agregado de uma enquete que este provider enviou (fallback local). */
  getPollResults(pollId: string): Promise<PollResults | null>;

  /** Desloga do WhatsApp e apaga as credenciais (pareamento perdido). */
  logout(): Promise<void>;

  /**
   * Libera recursos (sockets, browser) SEM deslogar. Usado em
   * shutdown/redeploy — a sessão pode ser restaurada depois.
   */
  destroy(): Promise<void>;

  /**
   * Processa um webhook de ENTRADA vindo da fonte do provider.
   * Providers com socket próprio (Baileys) não usam isto — recebem via
   * socket. Cloud API (Meta) e whatsmeow (sidecar) recebem mensagens por HTTP,
   * então normalizam aqui e emitem o evento `message`.
   */
  handleInboundWebhook(payload: unknown, meta?: Record<string, unknown>): Promise<void>;

  /**
   * Autentica a ORIGEM de um webhook de entrada (assinatura HMAC do corpo cru).
   * `false` → o controller responde 401 e o payload NÃO é processado. Adapters
   * que recebem por socket não implementam.
   */
  verifyInboundWebhook?(meta: InboundWebhookMeta): boolean;

  /** A engine suporta export/import de credenciais MD (trocar engine sem QR)? */
  readonly portableCredentials: boolean;
  /** Exporta a identidade do device (Multi-Device) em formato canônico. */
  exportCredentials(): Promise<PortableCredentials>;
  /** Importa credenciais canônicas — o device passa a ser aquele já linkado. */
  importCredentials(creds: PortableCredentials): Promise<void>;

  // ── pareamento ────────────────────────────────────
  /** Pairing por código de 8 dígitos (alternativa ao QR), quando suportado. */
  requestPairingCode?(phone: string): Promise<{ code: string }>;

  // ── etiquetas (gated por capabilities.labels) ──────
  listLabels?(): Promise<Label[]>;
  upsertLabel?(input: UpsertLabelInput): Promise<Label>;
  deleteLabel?(labelId: string): Promise<void>;
  setLabelForTarget?(labelId: string, target: LabelTarget, on: boolean): Promise<void>;
  getLabelsForTarget?(target: LabelTarget): Promise<Label[]>;
  getChatsForLabel?(labelId: string): Promise<string[]>;

  // ── conveniência (gated por capabilities.*) ────────
  blockContact?(jid: string): Promise<void>;
  unblockContact?(jid: string): Promise<void>;
  setPresence?(input: SetPresenceInput): Promise<void>;
  getPresence?(jid: string): Promise<PresenceInfo>;
  fetchMessages?(chatId: string, opts: FetchMessagesOptions): Promise<FetchMessagesPage>;
  /** checagem "crua" — o gating anti-ban fica no serviço, não aqui. */
  checkNumbers?(numbers: string[]): Promise<NumberCheckResult[]>;
  /** `typing`: exibe "digitando…" junto da confirmação de leitura, onde a engine suporta. */
  markRead?(chatId: string, messageIds?: string[], opts?: { typing?: boolean }): Promise<void>;

  // ── mídia ─────────────────────────────────────────
  /** Baixa a mídia de uma mensagem recebida, em STREAMING. `null` se não houver. */
  downloadMedia?(msg: NormalizedMessage): Promise<Readable | null>;

  // ── newsletter (gated por capabilities.newsletter) ─
  listNewsletters?(): Promise<NewsletterInfo[]>;
  newsletterMetadata?(jid: string): Promise<NewsletterInfo>;
  followNewsletter?(jid: string): Promise<void>;
  unfollowNewsletter?(jid: string): Promise<void>;
  createNewsletter?(input: CreateNewsletterInput): Promise<NewsletterInfo>;

  // ── grupos (gated por capabilities.groups) ─────────
  listGroups?(): Promise<GroupInfo[]>;
  groupMetadata?(jid: string): Promise<GroupInfo>;
  createGroup?(input: CreateGroupInput): Promise<GroupInfo>;
  updateGroupParticipants?(
    jid: string,
    participants: string[],
    action: GroupParticipantAction,
  ): Promise<GroupParticipantResult[]>;
  updateGroupSubject?(jid: string, subject: string): Promise<void>;
  updateGroupDescription?(jid: string, description: string): Promise<void>;
  updateGroupSetting?(jid: string, setting: GroupSetting): Promise<void>;
  getGroupInviteCode?(jid: string): Promise<string>;
  revokeGroupInviteCode?(jid: string): Promise<string>;
  joinGroupViaInvite?(code: string): Promise<{ jid: string }>;
  leaveGroup?(jid: string): Promise<void>;

  // ── comunidades (gated por capabilities.communities) ─
  /** `onlyOwnedOrAdmin` filtra pra só as comunidades onde a própria conta é admin/superadmin. */
  listCommunities?(onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]>;
  communityMetadata?(jid: string): Promise<CommunityInfo>;
  createCommunity?(input: CreateCommunityInput): Promise<CommunityInfo>;
  /**
   * Nem toda engine expõe "apagar para todos" via protocolo — quando não
   * suportado, o adapter documenta a aproximação (ex.: Baileys só sai — ver
   * `BaileysProvider.deleteCommunity`).
   */
  deleteCommunity?(jid: string): Promise<void>;
  updateCommunitySubject?(jid: string, subject: string): Promise<void>;
  updateCommunityDescription?(jid: string, description: string): Promise<void>;
  updateCommunityImage?(jid: string, image: UpdateCommunityImageInput): Promise<void>;
  updateCommunityAdmins?(
    jid: string,
    members: string[],
    action: CommunityAdminAction,
  ): Promise<GroupParticipantResult[]>;
  listCommunityMembers?(jid: string): Promise<CommunityParticipant[]>;
  countCommunityMembers?(jid: string): Promise<number>;
  getCommunityInviteCode?(jid: string): Promise<string>;
  revokeCommunityInviteCode?(jid: string): Promise<string>;
  /** Sonda o convite sem expor o código (liveness/anti-ban) — ver `probeCommunityInvite` no serviço. */
  probeCommunityInvite?(jid: string): Promise<CommunityInviteProbeResult>;
  listCommunityLinkedGroups?(jid: string): Promise<CommunityLinkedGroup[]>;
  linkGroupToCommunity?(groupJid: string, communityJid: string): Promise<void>;
  unlinkGroupFromCommunity?(groupJid: string, communityJid: string): Promise<void>;
  /** Reconsulta metadados/participantes de UMA comunidade e re-emite os eventos de sync. */
  syncCommunity?(jid: string): Promise<CommunityInfo>;
  /** Reconsulta TODAS as comunidades de que a conta participa (mesmo filtro `onlyOwnedOrAdmin`). */
  syncAllCommunities?(onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]>;

  // ── perfil (gated por capabilities.profile) ────────
  /** Nome/foto da própria conta conectada nesta instância. */
  getProfile?(): Promise<ProfileInfo>;
  /** Atualiza o perfil de negócio (Cloud API — gated por capabilities.updateProfile). */
  updateProfile?(input: UpdateProfileInput): Promise<void>;
  /** Edita o perfil da PRÓPRIA conta conectada (gated por capabilities.updateOwnProfile). */
  updateOwnProfile?(input: UpdateOwnProfileInput): Promise<void>;

  // ── conta/WABA (Cloud-only, gated por capabilities.cloudAccount) ──
  listPhoneNumbers?(): Promise<PhoneNumberInfo[]>;
  getPhoneNumber?(): Promise<PhoneNumberInfo>;
  requestVerificationCode?(input: RequestCodeInput): Promise<void>;
  verifyCode?(code: string): Promise<void>;
  registerNumber?(input: RegisterNumberInput): Promise<void>;
  deregisterNumber?(): Promise<void>;
  setTwoStepPin?(pin: string): Promise<void>;
  getWabaInfo?(): Promise<unknown>;
  subscribeApp?(): Promise<unknown>;
  listSubscribedApps?(): Promise<unknown>;
  unsubscribeApp?(): Promise<void>;
  messagingAnalytics?(query: MessagingAnalyticsQuery): Promise<unknown>;
  pricingAnalytics?(query: PricingAnalyticsQuery): Promise<unknown>;
  /** Aponta o webhook do número para uma URL própria (override por número). */
  setWebhookOverride?(input: { callbackUri: string; verifyToken: string }): Promise<void>;
  clearWebhookOverride?(): Promise<void>;

  // ── avatar de contato arbitrário (gated por capabilities.contactAvatar) ──
  /** Foto de perfil de QUALQUER jid (contato/grupo) — usado pelo refetch lazy do Inbox. `undefined` sem foto/privacidade restringindo, nunca erro. */
  getContactAvatar?(jid: string): Promise<string | undefined>;

  // ── histórico (gated por capabilities.history) ─────
  /**
   * Solicita sincronização de histórico sob demanda. Resolve quando a REQUISIÇÃO
   * foi feita; os lotes chegam de forma assíncrona pelo evento `history`.
   */
  requestHistorySync?(opts: {
    chatId?: string;
    count: number;
    before?: HistoryCursor;
  }): Promise<{ requested: boolean }>;

  // ── ações sobre mensagens existentes (gated por capabilities.*) ──
  /** Reage a uma mensagem (emoji; string vazia remove). */
  reactMessage?(input: ReactMessageInput): Promise<SendResult>;
  /** Edita o texto de uma mensagem já enviada (só a própria). */
  editMessage?(input: EditMessageInput): Promise<SendResult>;
  /** Apaga uma mensagem (para todos / revoke, ou só pra mim). */
  deleteMessage?(input: DeleteMessageInput): Promise<SendResult>;

  // ── novos tipos de envio (gated por capabilities.*) ──
  /** Envia uma mensagem de localização (lat/long). */
  sendLocation?(input: SendLocationInput): Promise<SendResult>;
  /** Envia um ou mais cartões de contato (vCard). */
  sendContact?(input: SendContactInput): Promise<SendResult>;
  /** Posta um Status/Story (broadcast). */
  sendStatus?(input: SendStatusInput): Promise<SendResult>;
  /** Pede a localização do usuário (Cloud API — interactive location_request). */
  requestLocation?(to: string, text: string): Promise<SendResult>;

  // ── templates HSM (gated por capabilities.templates — Cloud-only) ──
  listTemplates?(filter?: TemplateFilter): Promise<MessageTemplate[]>;
  getTemplate?(idOrName: string): Promise<MessageTemplate>;
  createTemplate?(input: CreateTemplateInput): Promise<CreateTemplateResult>;
  editTemplate?(id: string, patch: EditTemplatePatch): Promise<void>;
  deleteTemplate?(input: DeleteTemplateInput): Promise<void>;
  sendTemplate?(input: SendTemplateInput): Promise<SendResult>;
  templateAnalytics?(query: TemplateAnalyticsQuery): Promise<unknown>;

  // ── flows (gated por capabilities.flows — Cloud-only) ──
  listFlows?(): Promise<Flow[]>;
  getFlow?(id: string): Promise<Flow>;
  createFlow?(input: CreateFlowInput): Promise<CreateFlowResult>;
  updateFlowJson?(id: string, flowJson: string): Promise<{ validation_errors: unknown[] }>;
  publishFlow?(id: string): Promise<void>;
  deprecateFlow?(id: string): Promise<void>;
  deleteFlow?(id: string): Promise<void>;
  sendFlow?(input: SendFlowInput): Promise<SendResult>;
  /** Atualiza nome/categorias/endpoint_uri/app (o Flow JSON vai por `updateFlowJson`). */
  updateFlowMetadata?(id: string, input: UpdateFlowMetadataInput): Promise<void>;
  /** Assets do Flow (o Flow JSON vigente, com URL temporária de download). */
  listFlowAssets?(id: string): Promise<FlowAsset[]>;
  /** Conteúdo do Flow JSON vigente (baixado pelo adapter — a URL do asset é temporária). */
  getFlowJson?(id: string): Promise<string | null>;
  /** Estado da chave pública registrada para o número + se há chave privada local. */
  getFlowEncryption?(): Promise<FlowEncryptionInfo>;
  /** Gera/importa o par de chaves e registra a pública na Meta. */
  setFlowEncryption?(input: SetFlowEncryptionInput): Promise<FlowEncryptionInfo>;
  /**
   * Endpoint de troca de dados (Data API): autentica, decifra, delega a decisão
   * e devolve a resposta JÁ cifrada com o status HTTP que o protocolo exige.
   */
  handleFlowEndpoint?(
    req: FlowEndpointHttpRequest,
    handlers: FlowEndpointHandlers,
  ): Promise<{ status: number; body: string }>;

  // ── grupos da Cloud API (gated por capabilities.cloudGroups — Cloud-only) ──
  listCloudGroups?(): Promise<GroupInfo[]>;
  getCloudGroup?(groupId: string): Promise<GroupInfo>;
  createCloudGroup?(input: { subject: string; description?: string }): Promise<GroupInfo>;
  deleteCloudGroup?(groupId: string): Promise<void>;
  getCloudGroupInvite?(groupId: string): Promise<{ code: string; url: string }>;
  resetCloudGroupInvite?(groupId: string): Promise<{ code: string; url: string }>;
  removeCloudGroupParticipant?(groupId: string, waId: string): Promise<void>;

  // ── calling (gated por capabilities.calling — Cloud-only, só sinalização) ──
  configureCalling?(settings: unknown): Promise<void>;
  getCallingSettings?(): Promise<unknown>;
  requestCallPermission?(to: string, text?: string): Promise<SendResult>;
  getCallPermission?(waId: string): Promise<unknown>;
  connectCall?(input: ConnectCallInput): Promise<{ id?: string }>;

  on<K extends keyof ProviderEventMap>(
    event: K,
    handler: (payload: ProviderEventMap[K]) => void,
  ): void;
  off<K extends keyof ProviderEventMap>(
    event: K,
    handler: (payload: ProviderEventMap[K]) => void,
  ): void;
}

/**
 * Base com EventEmitter tipado + helpers comuns. Todos os adapters
 * estendem esta classe para não reimplementar emissão de eventos/estado.
 */
export abstract class BaseProvider extends EventEmitter implements WhatsAppProvider {
  abstract readonly type: ProviderType;
  readonly instanceId: string;

  /** Por padrão, nada além do núcleo. Adapters sobrescrevem o que suportam. */
  readonly capabilities: ProviderCapabilities = {};

  protected status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
  protected readonly config: Record<string, unknown>;
  protected readonly sessionStore: SessionStore;
  protected readonly logger: Logger;
  /** resolução LID↔PN — opcional até o IdentityModule ser plugado. */
  protected readonly identity?: IdentityResolver;
  protected readonly identityMode: IdentityMode;
  /** cache efêmero entre workers, já namespaced por instância (opcional). */
  protected readonly cache?: ProviderCache;

  constructor(ctx: ProviderContext) {
    super();
    this.setMaxListeners(50);
    this.instanceId = ctx.instanceId;
    this.config = ctx.config;
    this.sessionStore = ctx.sessionStore;
    this.logger = ctx.logger;
    this.identity = ctx.identity;
    this.identityMode = ctx.identityMode ?? 'auto';
    this.cache = ctx.cache;
  }

  abstract initialize(): Promise<void>;
  abstract getQRCode(): Promise<QrPayload | null>;
  abstract sendText(input: SendTextInput): Promise<SendResult>;
  abstract sendMedia(input: SendMediaInput): Promise<SendResult>;
  abstract logout(): Promise<void>;
  abstract destroy(): Promise<void>;

  // ── interativos: defaults conservadores ───────────
  async sendPoll(_i: SendPollInput): Promise<SendResult> {
    throw new InteractiveUnsupportedError('poll', this.type);
  }
  async sendButtons(_i: SendButtonsInput): Promise<SendResult> {
    throw new InteractiveUnsupportedError('buttons', this.type);
  }
  async sendList(_i: SendListInput): Promise<SendResult> {
    throw new InteractiveUnsupportedError('list', this.type);
  }
  async sendPix(_i: SendPixInput): Promise<SendResult> {
    throw new InteractiveUnsupportedError('pix', this.type);
  }
  async getPollResults(_pollId: string): Promise<PollResults | null> {
    return null;
  }

  /** Texto formatado para o fallback (buttons/list/pix → texto legível). */
  protected renderFallbackText(input: SendButtonsInput | SendListInput | SendPixInput): string {
    if ('buttons' in input) {
      const opts = input.buttons
        .map((b, i) => `${i + 1}. ${b.title}${b.type === 'url' ? ` — ${b.url}` : ''}`)
        .join('\n');
      return [input.text, '', opts, input.footer].filter(Boolean).join('\n');
    }
    if ('sections' in input) {
      const opts = input.sections
        .flatMap((s) => [s.title ? `*${s.title}*` : '', ...s.rows.map((r) => `• ${r.title}`)])
        .filter(Boolean)
        .join('\n');
      return [input.title, input.text, '', opts, input.footer].filter(Boolean).join('\n');
    }
    // PIX
    return [
      `*${input.pix.merchant}*`,
      `Chave PIX (${input.pix.keyType}): ${input.pix.key}`,
      input.pix.code ? `\nCopia e cola:\n${input.pix.code}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** No-op por padrão: só Cloud API e whatsmeow sobrescrevem. */
  async handleInboundWebhook(_payload: unknown, _meta?: Record<string, unknown>): Promise<void> {
    /* providers com socket próprio não recebem por webhook */
  }

  /** Por padrão a engine não suporta migração de credenciais. */
  readonly portableCredentials: boolean = false;
  async exportCredentials(): Promise<PortableCredentials> {
    throw new Error(`Engine ${this.type} não suporta export de credenciais`);
  }
  async importCredentials(_creds: PortableCredentials): Promise<void> {
    throw new Error(`Engine ${this.type} não suporta import de credenciais`);
  }

  getStatus(): ConnectionStatus {
    return this.status;
  }

  // Sobrescreve on/off/emit apenas para dar tipagem forte aos eventos.
  on<K extends keyof ProviderEventMap>(
    event: K,
    handler: (payload: ProviderEventMap[K]) => void,
  ): this {
    return super.on(event as string, handler as (...args: unknown[]) => void);
  }

  off<K extends keyof ProviderEventMap>(
    event: K,
    handler: (payload: ProviderEventMap[K]) => void,
  ): this {
    return super.off(event as string, handler as (...args: unknown[]) => void);
  }

  protected emitTyped<K extends keyof ProviderEventMap>(
    event: K,
    payload: ProviderEventMap[K],
  ): void {
    super.emit(event as string, payload);
  }

  /** Atualiza o status interno e propaga um evento `connection`. */
  protected setStatus(status: ConnectionStatus, extra?: Partial<ConnectionUpdate>): void {
    this.status = status;
    this.emitTyped('connection', {
      provider: this.type,
      instanceId: this.instanceId,
      status,
      ...extra,
    });
  }

  protected emitError(error: Error): void {
    this.logger.error(`[${this.instanceId}] ${error.message}`, error.stack);
    this.emitTyped('error', { instanceId: this.instanceId, provider: this.type, error });
  }

  /** Emite um evento de webhook genérico (chats, grupos, presença, etc.). */
  protected emitWebhook(event: WebhookEvent, payload: unknown): void {
    this.emitTyped('webhook', {
      instanceId: this.instanceId,
      provider: this.type,
      event,
      payload,
    });
  }
}
