import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ApiKeyAction } from '@wamux/shared';

/**
 * API key com escopo restrito, por instância — em cima do modelo atual
 * (`InstanceEntity.apiKey`, a key MESTRA, continua com todas as ações e
 * SEM hash, por retrocompatibilidade — ver `docs/api-keys-mcp-handoff.md`
 * §9). Só as keys NOVAS, criadas aqui, têm escopo e ficam hasheadas.
 */
@Entity('api_keys')
@Index(['instanceId'])
export class ApiKeyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  instanceId!: string;

  /** hash SHA-256 da key — nunca o valor cru. Único, é o que o guard busca. */
  @Column({ unique: true })
  keyHash!: string;

  /** primeiros 8 chars da key crua — só pra reconhecer/exibir, nunca a key inteira. */
  @Column()
  keyPrefix!: string;

  @Column()
  label!: string;

  /** varchar[] (não enum nativo) — mesmo padrão de ContactEntity/ActivityLogEntity, evita ALTER TYPE. */
  @Column({ type: 'varchar', array: true })
  actions!: ApiKeyAction[];

  @Column({ type: 'varchar', default: 'generic' })
  kind!: 'generic' | 'mcp';

  @Column({ type: 'timestamptz', nullable: true })
  lastUsedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  revokedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;
}
