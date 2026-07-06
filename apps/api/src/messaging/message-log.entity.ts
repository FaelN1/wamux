import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
