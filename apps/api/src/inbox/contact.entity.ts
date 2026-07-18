import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { ChatType, MessageAckStatus, MessageType } from '../providers/provider.types';

/**
 * Design de "uma tabela só" (ver `docs/inbox-persistencia-handoff.md` §3.1):
 * cada linha é ao mesmo tempo contato **e** chat — sem `ChatEntity` separada.
 * `type` é derivado do jid (`user`/`group`/`newsletter`/`broadcast`); grupo e
 * canal cabem na mesma tabela, não são "pessoa". Escrita gated por
 * `persistence.contacts` (opt-in) em `InboxStoreService` (fase 2).
 */
@Entity('contacts')
@Index(['instanceId', 'jid'], { unique: true })
@Index(['instanceId', 'lastMessageAt']) // ordenação "Newest first" da lista
export class ContactEntity {
  @PrimaryColumn()
  instanceId!: string;

  @PrimaryColumn()
  jid!: string;

  @Column({ type: 'varchar' })
  type!: ChatType;

  // ── identidade ──

  /** `NormalizedMessage.pushName` — nunca vazio quando presente. */
  @Column({ type: 'varchar' })
  pushName!: string;

  /** nome salvo na agenda / metadata do grupo, quando o engine expõe. */
  @Column({ type: 'varchar', nullable: true })
  name?: string | null;

  @Column({ type: 'varchar', nullable: true })
  verifiedName?: string | null;

  @Column({ default: false })
  isBusiness!: boolean;

  /** enriquecido lazy via `provider.getProfile`/`profilePicUrl`; pode expirar. */
  @Column({ type: 'text', nullable: true })
  avatarUrl?: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  avatarFetchedAt?: Date | null;

  // ── estado de conversa (o que faz o contato "virar chat" na lista) ──

  @Column({ type: 'varchar', nullable: true })
  lastMessageId?: string | null;

  /** preview da lista ("Ok", "Obrigada", …). */
  @Column({ type: 'text', nullable: true })
  lastMessageText?: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastMessageType?: MessageType | null;

  @Column({ default: false })
  lastMessageFromMe!: boolean;

  /**
   * Denormalizado do `message_logs.ack` — evita join por linha só pra
   * mostrar ✓✓ na lista de conversas. Atualizado só quando o status é da
   * mensagem que É a `lastMessageId` atual (ver `InboxStoreService.onStatus`).
   */
  @Column({ type: 'varchar', nullable: true })
  lastMessageAck?: MessageAckStatus | null;

  /** unix (s) — cursor de ordenação "Newest first". */
  @Column({ type: 'bigint', nullable: true })
  lastMessageAt?: string | null;

  @Column({ default: 0 })
  unreadCount!: number;

  @Column({ default: false })
  archived!: boolean;

  @Column({ default: false })
  pinned!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
