import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { FlowSessionStatus } from '../providers/provider.types';

/**
 * Execução de um WhatsApp Flow. O `flowToken` é a chave de correlação que a
 * Meta devolve em toda chamada ao endpoint de troca de dados e na resposta
 * final (`nfm_reply`) — único por instância.
 */
@Entity('flow_sessions')
@Index(['instanceId', 'flowToken'], { unique: true })
@Index(['instanceId', 'createdAt'])
export class FlowSessionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  instanceId!: string;

  @Column()
  flowToken!: string;

  @Column({ type: 'varchar', nullable: true })
  flowId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  flowName?: string | null;

  /** destinatário (dígitos). */
  @Column({ type: 'varchar', nullable: true })
  contact?: string | null;

  /** id da mensagem que abriu o Flow. */
  @Column({ type: 'varchar', nullable: true })
  messageId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  mode?: string | null;

  @Column({ type: 'varchar', default: 'sent' })
  status!: FlowSessionStatus;

  @Column({ type: 'varchar', nullable: true })
  lastScreen?: string | null;

  @Column({ type: 'varchar', nullable: true })
  lastAction?: string | null;

  @Column({ type: 'int', default: 0 })
  exchanges!: number;

  @Column({ type: 'jsonb', nullable: true })
  response?: Record<string, unknown> | null;

  @Column({ type: 'varchar', nullable: true })
  responseMessageId?: string | null;

  @Column({ type: 'jsonb', nullable: true })
  error?: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', nullable: true })
  completedAt?: Date | null;
}
