/**
 * Inbox — leitura persistida de contatos/chats/mensagens (opt-in via env,
 * ver `PersistenceConfig`). Modelo de leitura só; a escrita é interna à API
 * (`InboxStoreService`). Design de "uma tabela só": cada `ChatSummary` é ao
 * mesmo tempo contato e chat — ver `docs/inbox-persistencia-handoff.md`.
 */
import { MessageAckStatus, MessageType } from './enums';
import { ChatType } from './messages';

/** Linha da lista de conversas ("Conversations" do painel). */
export interface ChatSummary {
  /** jid do chat — usuário, grupo (`@g.us`) ou canal (`@newsletter`). */
  jid: string;
  type: ChatType;
  /** nome de exibição resolvido (name → verifiedName → pushName → jid). */
  name: string;
  pushName?: string;
  avatarUrl?: string;
  lastMessageId?: string;
  lastMessageText?: string;
  lastMessageType?: MessageType;
  lastMessageFromMe?: boolean;
  /** denormalizado do log de mensagem — ✓✓ na lista sem precisar de join. */
  lastMessageAck?: MessageAckStatus;
  /** unix (s) — cursor de ordenação "Newest first". */
  lastMessageAt?: number;
  unreadCount: number;
  archived: boolean;
  pinned: boolean;
}

/** Contato persistido (identidade — sem estado de conversa). */
export interface ContactSummary {
  jid: string;
  pushName: string;
  name?: string;
  verifiedName?: string;
  isBusiness: boolean;
  avatarUrl?: string;
}

/** Item da thread persistida (`GET /chats/:jid/messages`). */
export interface ChatMessage {
  id: string;
  chatId: string;
  fromMe: boolean;
  type: MessageType;
  text?: string;
  /** nome do remetente na hora do envio (grupos: quem mandou). */
  pushName?: string;
  /**
   * jid de quem mandou (participante, em grupo — distinto do `chatId`, que
   * é o grupo; igual ao `chatId` em 1:1, sem participant no protocolo).
   * Ausente pra mensagens outbound (`fromMe: true` — sempre "nós").
   */
  senderId?: string;
  /** foto do remetente — resolvida por `InboxQueryService`, mesmo mecanismo do `ChatSummary.avatarUrl`. Só populado em grupo. */
  senderAvatarUrl?: string;
  mediaUrl?: string;
  mediaMimetype?: string;
  /** nome original do arquivo — render de documento na thread (ícone+nome). */
  mediaFilename?: string;
  mediaCaption?: string;
  /** id da mensagem citada (reply), quando houver. */
  quotedId?: string;
  /** emoji agregado, quando disponível (fase 2 do design). */
  reaction?: string;
  ack: MessageAckStatus;
  /** unix (s). */
  timestamp: number;
}

/** Página cursor-based (mesmo padrão em toda leitura paginada do inbox). */
export interface PaginatedResult<T> {
  items: T[];
  /** cursor opaco para a próxima página; ausente = fim. */
  nextCursor?: string;
}
