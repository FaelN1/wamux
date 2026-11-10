import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { MessageAckStatus, MessageSource, MessageType } from '../providers/provider.types';

/**
 * Log de mensagens (enviadas e recebidas). Idempotência, rastreio de ack com
 * timestamps por transição e origem live/import.
 */
@Entity('message_logs')
@Index(['instanceId', 'chatId'])
@Index(['instanceId', 'chatId', 'timestamp']) // cursor de leitura por data
export class MessageLogEntity {
  /** id da mensagem no WhatsApp — chave natural de dedup. */
  @PrimaryColumn()
  id!: string;

  @Column()
  instanceId!: string;

  @Column()
  chatId!: string;

  @Column({ default: false })
  fromMe!: boolean;

  @Column({ type: 'varchar', default: MessageType.TEXT })
  type!: MessageType;

  @Column({ type: 'text', nullable: true })
  text?: string | null;

  @Column({ type: 'varchar', default: MessageAckStatus.PENDING })
  ack!: MessageAckStatus;

  /** id do cliente (idempotência de envio) — liga o log ao clientMessageId. */
  @Column({ type: 'varchar', nullable: true })
  clientMessageId?: string | null;

  @Column({ type: 'timestamptz', nullable: true }) serverAckAt?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) deliveredAt?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) readAt?: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) failedAt?: Date | null;

  @Column({ type: 'text', nullable: true })
  failureReason?: string | null;

  /** Origem do registro: recebido ao vivo vs. importado do histórico. */
  @Column({ type: 'varchar', default: 'live' })
  source!: MessageSource;

  /** timestamp (unix segundos) da mensagem — para range e paginação por data. */
  @Column({ type: 'bigint', nullable: true })
  timestamp?: string | null;

  // ── campos de render (Inbox — opt-in via `persistence.newMessage`) ──
  // Gravados só quando a flag correspondente está ligada; ausentes, o
  // registro segue servindo só como log de ack/auditoria (uso original).

  /** nome do remetente na hora do envio. */
  @Column({ type: 'varchar', nullable: true })
  pushName?: string | null;

  /**
   * jid de quem MANDOU a mensagem (`NormalizedMessage.from`) — em grupo é o
   * participante (`…@s.whatsapp.net`/`…@lid`), distinto do `chatId` (o
   * grupo). Em 1:1 é igual ao `chatId` (sem participant no protocolo). Só
   * gravado no inbound — outbound é sempre "nós", não precisa. Usado pra
   * resolver avatar/identidade por MENSAGEM na thread de grupo (ver
   * `InboxQueryService.listMessages`).
   */
  @Column({ type: 'varchar', nullable: true })
  senderId?: string | null;

  /** url servível da mídia (`media.url`) — só quando `storeMediaBody` ligado. */
  @Column({ type: 'text', nullable: true })
  mediaUrl?: string | null;

  @Column({ type: 'varchar', nullable: true })
  mediaMimetype?: string | null;

  /** nome original do arquivo — pro render de documento na thread (ícone+nome). */
  @Column({ type: 'varchar', nullable: true })
  mediaFilename?: string | null;

  @Column({ type: 'text', nullable: true })
  mediaCaption?: string | null;

  /** id da mensagem citada (reply), quando houver. */
  @Column({ type: 'varchar', nullable: true })
  quotedId?: string | null;

  /** emoji agregado — reservado pra fase 2 do design; não escrito ainda. */
  @Column({ type: 'varchar', nullable: true })
  reaction?: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
