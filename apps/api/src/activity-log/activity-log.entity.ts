import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ActivityLogStatus, ActivityLogType } from '@wamux/shared';

/**
 * Painel de Logs/Atividade — uma linha por evento (mensageria, conexão/QR,
 * grupos, comunidades, newsletter, requisição de API em geral). Escrita
 * gated por `activityLog.enabled` (opt-in) em `ActivityLogService` (fase 2).
 * `type`/`status` como `varchar` (não `enum` nativo do Postgres) — mesmo
 * padrão de `ContactEntity`/`MessageLogEntity`, evita `ALTER TYPE` ao
 * adicionar valores novos.
 */
@Entity('activity_logs')
@Index(['createdAt'])
@Index(['instanceId', 'createdAt'])
@Index(['type', 'createdAt'])
@Index(['status', 'createdAt'])
export class ActivityLogEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /** `null` = evento admin/global, sem instância associada. */
  @Column({ type: 'varchar', nullable: true })
  instanceId?: string | null;

  @Column({ type: 'varchar' })
  type!: ActivityLogType;

  @Column({ type: 'varchar' })
  status!: ActivityLogStatus;

  /** rótulo curto: "Message Received", "POST .../groups". */
  @Column({ type: 'varchar' })
  activity!: string;

  @Column({ type: 'varchar', nullable: true })
  method?: string | null;

  /** padrão da rota (com `:id`), nunca a URL com valores. */
  @Column({ type: 'varchar', nullable: true })
  route?: string | null;

  @Column({ type: 'int', nullable: true })
  statusCode?: number | null;

  @Column({ type: 'int', nullable: true })
  durationMs?: number | null;

  /** `ProviderType` da instância, quando aplicável. */
  @Column({ type: 'varchar', nullable: true })
  platform?: string | null;

  /** `"global"` ou `"instance:<prefixo>"` — nunca a key em si. */
  @Column({ type: 'varchar', nullable: true })
  apiKeyLabel?: string | null;

  /** preview curto (texto/erro/payload resumido). */
  @Column({ type: 'text', nullable: true })
  message?: string | null;

  /** drill-down (ex.: `req.params`, detalhe do erro). */
  @Column({ type: 'jsonb', nullable: true })
  metadata?: Record<string, unknown> | null;

  @CreateDateColumn()
  createdAt!: Date;
}
