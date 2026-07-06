import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { HistoryImportStatus } from '@wamux/shared';

/** Estado/progresso de um import de histórico. Fonte da verdade — os
 *  jobs BullMQ são efêmeros. */
@Entity('history_import_jobs')
@Index(['instanceId'])
export class HistoryImportJobEntity {
  /** = jobId do BullMQ (uuid). */
  @PrimaryColumn()
  id!: string;

  @Column()
  instanceId!: string;

  @Column({ type: 'varchar', default: 'queued' })
  status!: HistoryImportStatus;

  @Column({ type: 'bigint', nullable: true }) from?: string | null;
  @Column({ type: 'bigint', nullable: true }) to?: string | null;
  @Column({ type: 'jsonb', default: () => "'[]'" }) chats!: string[];
  @Column({ default: false }) deliverToWebhook!: boolean;

  @Column({ type: 'int', default: 0 }) imported!: number;
  @Column({ type: 'int', default: 0 }) duplicates!: number;
  @Column({ type: 'int', default: 0 }) chatsProcessed!: number;
  @Column({ type: 'bigint', nullable: true }) oldestReached?: string | null;
  @Column({ type: 'text', nullable: true }) message?: string | null;

  @CreateDateColumn() createdAt!: Date;
  @UpdateDateColumn() updatedAt!: Date;
}
