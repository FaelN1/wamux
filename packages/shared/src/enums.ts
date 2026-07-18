/** Engines suportadas — escolhida por instância. */
export enum ProviderType {
  BAILEYS = 'baileys',
  WEBJS = 'webjs',
  CLOUD_API = 'cloud',
  WHATSMEOW = 'whatsmeow',
}

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  /** Aguardando leitura do QR Code (não se aplica à Cloud API). */
  QR = 'qr',
  /** QR regenerado N vezes sem leitura → paramos de gerar (evita loop). */
  QR_EXPIRED = 'qr_expired',
  /** Pareamento em curso: pairing code enviado ou handshake em andamento. */
  PAIRING = 'pairing',
  /** QR lido; aguardando o usuário aprovar o passkey no celular primário. */
  PASSKEY_PENDING = 'passkey_pending',
  CONNECTED = 'connected',
  /** Sessão encerrada pelo WhatsApp (precisa parear de novo). */
  LOGGED_OUT = 'logged_out',
  ERROR = 'error',
}

export enum MessageType {
  TEXT = 'text',
  IMAGE = 'image',
  VIDEO = 'video',
  AUDIO = 'audio',
  DOCUMENT = 'document',
  STICKER = 'sticker',
  LOCATION = 'location',
  CONTACT = 'contact',
  /** enquete nativa do WhatsApp. */
  POLL = 'poll',
  /** mensagem com botões de resposta. */
  BUTTONS = 'buttons',
  /** mensagem de lista (menu). */
  LIST = 'list',
  /** interativa/nativeFlow (ex.: botão PIX). */
  INTERACTIVE = 'interactive',
  UNKNOWN = 'unknown',
}

export enum MessageAckStatus {
  PENDING = 'pending',
  SERVER = 'server_ack',
  DELIVERED = 'delivered',
  READ = 'read',
  PLAYED = 'played',
  FAILED = 'failed',
}

/**
 * Tipos de evento entregues no webhook do cliente. Nosso padrão é
 * `entidade.ação` (minúsculo, com ponto).
 * Nem toda engine emite todos: os avançados (chats,
 * grupos, contatos, presença, chamada, etiquetas) são de nível de protocolo
 * e hoje saem no Baileys; Cloud API/webjs têm superfícies mais estreitas.
 */
export enum WebhookEvent {
  // conexão & ciclo de vida
  CONNECTION_UPDATE = 'connection.update',
  QRCODE_UPDATED = 'qrcode.updated',
  LOGOUT_INSTANCE = 'logout.instance',
  // mensagens
  MESSAGE_RECEIVED = 'message.received',
  MESSAGE_SENT = 'message.sent',
  MESSAGE_STATUS = 'message.status',
  MESSAGE_DELETED = 'message.deleted',
  /** edição de mensagem normalizada. */
  MESSAGE_EDITED = 'message.edited',
  /** reação (emoji) normalizada. */
  MESSAGE_REACTION = 'message.reaction',
  /** voto de enquete (descriptografado e normalizado). */
  POLL_VOTE = 'poll.vote',
  // chats & contatos
  CHATS_UPSERT = 'chats.upsert',
  CHATS_UPDATE = 'chats.update',
  CHATS_DELETE = 'chats.delete',
  CONTACTS_UPSERT = 'contacts.upsert',
  CONTACTS_UPDATE = 'contacts.update',
  // grupos
  GROUPS_UPSERT = 'groups.upsert',
  GROUPS_UPDATE = 'groups.update',
  GROUP_PARTICIPANTS_UPDATE = 'groups.participants.update',
  // comunidades (grupo-pai + subgrupos vinculados)
  /** metadados + lista de participantes de uma comunidade foram (re)sincronizados. */
  COMMUNITY_PARTICIPANTS_SYNCED = 'communities.participants.synced',
  /** o subgrupo de anúncios de uma comunidade foi identificado (resolução assíncrona). */
  COMMUNITY_ANNOUNCEMENT_DISCOVERED = 'communities.announcement.discovered',
  // presença & chamadas
  PRESENCE_UPDATE = 'presence.update',
  CALL_RECEIVED = 'call.received',
  // etiquetas
  LABELS_EDIT = 'labels.edit',
  LABELS_ASSOCIATION = 'labels.association',
  // sistema
  /** freio anti-ban (auto-throttle) acionado. */
  ANTIBAN_ALERT = 'antiban.alert',
  ERROR = 'error',
}

/**
 * Categoria de evento no painel de Logs (ver `docs/logs-painel-handoff.md`).
 * Recorte próprio do WAMux — não é 1:1 com nenhum outro produto.
 */
export enum ActivityLogType {
  MESSAGING = 'messaging',
  CONNECTION = 'connection',
  GROUPS = 'groups',
  COMMUNITIES = 'communities',
  NEWSLETTER = 'newsletter',
  API_REQUEST = 'api_request',
}

/**
 * Resultado de um evento do painel de Logs. Mapeado em cima de conceitos que
 * já existem no gateway — nunca inventa estado novo (ver §2 do design doc):
 * `PENDING` = `queued: true` no outbound; `SKIPPED` = dedup de idempotência
 * ou capability gate (501).
 */
export enum ActivityLogStatus {
  SUCCESS = 'success',
  FAILED = 'failed',
  PENDING = 'pending',
  SKIPPED = 'skipped',
}
