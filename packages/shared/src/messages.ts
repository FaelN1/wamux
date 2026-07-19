import { ConnectionStatus, MessageAckStatus, MessageType, ProviderType } from './enums';

// ── identidade (@lid vs @jid) ───────────────────────

/** Modo de exposição do remoteJid ao cliente, por instância. */
export type IdentityMode = 'phone' | 'lid' | 'auto';

/**
 * Identidade canônica de um usuário. Unifica os dois identificadores do
 * WhatsApp; `primary` diz qual é a fonte-de-verdade estável desta identidade.
 */
export interface Identity {
  /** <id>@lid — não expõe o número. Estável mesmo se o número mudar. */
  lid?: string;
  /** <numero>@s.whatsapp.net — PN-JID clássico. */
  pnJid?: string;
  /** número em dígitos (E.164 sem '+'), quando conhecido. */
  phone?: string;
  /** qual identificador ancora a dedup: 'lid' quando presente, senão 'pn'. */
  primary: 'lid' | 'pn';
}

// ── chats / canais ──────────────────────────────────

export type ChatType = 'user' | 'group' | 'newsletter' | 'broadcast';

export interface Chat {
  id: string;
  type: ChatType;
  name?: string;
  unreadCount?: number;
}

export interface NewsletterInfo {
  /** <id>@newsletter */
  jid: string;
  name: string;
  description?: string;
  subscriberCount?: number;
  role?: 'owner' | 'admin' | 'subscriber' | 'guest';
  muted?: boolean;
  /** parte final do link whatsapp.com/channel/<code>. */
  inviteCode?: string;
  pictureUrl?: string;
  verified?: boolean;
}

export interface CreateNewsletterInput {
  name: string;
  description?: string;
}

// ── mídia ───────────────────────────────────────────

export interface NormalizedMedia {
  mimetype?: string;
  caption?: string;
  filename?: string;
  /** url servível (S3/MinIO/gateway) — SEMPRE preenchida quando o store está ligado. */
  url?: string;
  size?: number;
  /** áudio/vídeo, em segundos, quando a lib expõe. */
  duration?: number;
  isGif?: boolean;
  /** áudio-voz (PTT). */
  isPtt?: boolean;
  /** vídeo-nota redondo (PTV). */
  isPtv?: boolean;
  /** sticker animado. */
  animated?: boolean;
  /** setado quando o download/upload falhou — nunca deixamos url vazia sem motivo. */
  mediaError?: string;
}

/** Mensagem recebida/enviada, já normalizada (modelo canônico). */
export interface NormalizedMessage {
  provider: ProviderType;
  instanceId: string;
  id: string;
  chatId: string;
  from: string;
  fromMe: boolean;
  pushName?: string;
  isGroup: boolean;
  /** tipo do chat de origem, via classifyJid(chatId). */
  chatType?: ChatType;
  timestamp: number;
  type: MessageType;
  text?: string;
  media?: NormalizedMedia;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  /** identidade canônica do remetente (unifica lid/pn). Preenchida pelos adapters. */
  identity?: Identity;
  /** identidade do chat, quando distinta do remetente (1:1 = a mesma). */
  chatIdentity?: Identity;
  /** payload cru do provider, para depuração / campos não mapeados. */
  raw: unknown;
}

export interface MessageStatusUpdate {
  provider: ProviderType;
  instanceId: string;
  messageId: string;
  chatId: string;
  status: MessageAckStatus;
  timestamp: number;
}

export interface ConnectionUpdate {
  provider: ProviderType;
  instanceId: string;
  status: ConnectionStatus;
  qr?: string;
  qrImage?: string;
  wid?: string;
  reason?: string;
  /** código bruto do DisconnectReason (Baileys) — insumo da classificação. */
  statusCode?: number;
  /** nº de QRs gerados nesta sessão de pareamento (loop guard). */
  qrAttempts?: number;
  /** epoch (ms) em que o QR atual expira. */
  expiresAt?: number;
}

// ── edição / reação / exclusão normalizadas ─────────

export interface NormalizedReaction {
  provider: ProviderType;
  instanceId: string;
  messageId: string;
  chatId: string;
  from: string;
  fromMe: boolean;
  emoji: string;
  timestamp: number;
}

export interface NormalizedEdit {
  provider: ProviderType;
  instanceId: string;
  messageId: string;
  chatId: string;
  from: string;
  fromMe: boolean;
  text: string;
  timestamp: number;
}

export interface NormalizedDeletion {
  provider: ProviderType;
  instanceId: string;
  messageId: string;
  chatId: string;
  fromMe: boolean;
  timestamp: number;
}

// ── paginação de mensagens ──────────────────────────

/** Opções de paginação de fetchMessages. */
export interface FetchMessagesOptions {
  limit: number;
  /** cursor opaco (id da mensagem mais antiga já vista) para paginar. */
  before?: string;
}

/** Página de mensagens com cursor estável. */
export interface FetchMessagesPage {
  messages: NormalizedMessage[];
  /** cursor para a próxima página; ausente = fim. */
  nextCursor?: string;
}

// ── histórico ───────────────────────────────────────

/** Origem de um registro de mensagem: recebido ao vivo vs. importado. */
export type MessageSource = 'live' | 'import';

export type HistoryImportStatus = 'queued' | 'running' | 'done' | 'partial' | 'failed' | 'canceled';

/** Cursor para paginar histórico para trás (âncora = mensagem mais antiga vista). */
export interface HistoryCursor {
  id: string;
  fromMe: boolean;
  /** timestamp (segundos) da mensagem-âncora. */
  timestamp: number;
}

/** Lote de histórico entregue pela sincronização assíncrona. */
export interface HistoryBatch {
  provider: ProviderType;
  instanceId: string;
  messages: NormalizedMessage[];
  /** true quando a engine sinaliza que não há mais histórico a puxar. */
  isLatest?: boolean;
  /** tipo do sync reportado pela lib (ex.: 'ON_DEMAND', 'RECENT', 'FULL'). */
  syncType?: string;
}

// ── mensagens interativas ───────────────────────────

/** Enquete nativa do WhatsApp. selectableCount=1 → escolha única. */
export interface PollMessage {
  question: string;
  options: string[];
  /** quantas opções o usuário pode marcar (default 1). */
  selectableCount: number;
}

export type CanonicalButton =
  | { type: 'reply'; id: string; title: string }
  | { type: 'url'; title: string; url: string }
  | { type: 'call'; title: string; phone: string };

export interface ButtonsMessage {
  text: string;
  footer?: string;
  buttons: CanonicalButton[];
}

export interface ListRow {
  id: string;
  title: string;
  description?: string;
}
export interface ListSection {
  title?: string;
  rows: ListRow[];
}
export interface ListMessage {
  title?: string;
  text: string;
  footer?: string;
  buttonText: string;
  sections: ListSection[];
}

/** Botão PIX / copiar-código (BR). Modelado à parte por ser nativeFlow. */
export interface PixMessage {
  key: string;
  keyType: 'phone' | 'email' | 'cpf' | 'cnpj' | 'evp';
  merchant: string;
  /** BR Code "copia e cola", opcional (senão o cliente monta pela chave). */
  code?: string;
}

/**
 * Guarda-chuva para conteúdos nativeFlow crus (PIX e afins). Só o adapter
 * baileys materializa isso; os demais declaram capability=false.
 */
export interface InteractiveMessage {
  body: string;
  footer?: string;
  nativeFlow: Array<{ name: string; params: Record<string, unknown> }>;
}

// ── entradas de envio ────────────────────────────────────────

export interface SendTextInput {
  to: string;
  text: string;
  quotedMessageId?: string;
  linkPreview?: boolean;
}

export interface SendMediaInput {
  to: string;
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  url?: string;
  base64?: string;
  caption?: string;
  filename?: string;
  mimetype?: string;
  quotedMessageId?: string;
  // ── flags de mídia rica ──
  /** vídeo tocado como GIF (gifPlayback). */
  asGif?: boolean;
  /** áudio enviado como mensagem de voz (PTT). */
  asPtt?: boolean;
  /** vídeo enviado como vídeo-nota (PTV). */
  asPtv?: boolean;
  /** sticker animado (WebP animado). */
  animated?: boolean;
}

export interface SendPollInput {
  to: string;
  question: string;
  options: string[];
  selectableCount?: number;
  quotedMessageId?: string;
}

export interface SendButtonsInput {
  to: string;
  text: string;
  footer?: string;
  buttons: CanonicalButton[];
  /** degrada para texto formatado se a engine não entregar interativo. */
  fallbackToText?: boolean;
  quotedMessageId?: string;
}

export interface SendListInput {
  to: string;
  title?: string;
  text: string;
  footer?: string;
  buttonText: string;
  sections: ListSection[];
  fallbackToText?: boolean;
  quotedMessageId?: string;
}

export interface SendPixInput {
  to: string;
  pix: PixMessage;
  fallbackToText?: boolean;
  quotedMessageId?: string;
}

// ── ações sobre mensagens existentes (reagir/editar/apagar) ──

/** Referência canônica a uma mensagem já existente num chat. */
export interface MessageRef {
  /** chat onde a mensagem está (jid ou número). */
  chatId: string;
  /** id da mensagem-alvo. */
  messageId: string;
  /** a mensagem-alvo foi enviada por nós? (default false). */
  fromMe?: boolean;
  /** em grupo: jid do autor da mensagem-alvo (algumas engines exigem). */
  participant?: string;
}

export interface ReactMessageInput extends MessageRef {
  /** emoji da reação; string vazia REMOVE a reação. */
  emoji: string;
}

export interface EditMessageInput extends MessageRef {
  /** novo texto da mensagem. */
  text: string;
}

// ── coleta de voto + agregação ──────────────────────

/**
 * Voto normalizado (após descriptografia pelo adapter). Substitutivo:
 * `selectedOptions` é o estado ATUAL do votante, não um delta.
 */
export interface PollVoteUpdate {
  provider: ProviderType;
  instanceId: string;
  /** id da mensagem-enquete original. */
  pollId: string;
  chatId: string;
  /** quem votou (jid/lid). */
  voter: string;
  selectedOptions: string[];
  timestamp: number;
}

/** Agregação exposta em GET .../poll/:messageId. */
export interface PollResults {
  pollId: string;
  question: string;
  options: Array<{ name: string; votes: number; voters: string[] }>;
  totalVoters: number;
}

export interface SendResult {
  id: string;
  to: string;
  timestamp: number;
  status: 'sent' | 'queued';
  /** ack inicial; a entrega REAL é confirmada por evento. */
  ack?: MessageAckStatus;
  /** true quando o interativo degradou para texto (fallbackToText). */
  fallbackUsed?: boolean;
}
