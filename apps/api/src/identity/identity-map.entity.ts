import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * Mapa lid ↔ pnJid ↔ phone de uma instância. Índices únicos parciais
 * garantem no máximo um registro por `lid` e por `pnJid` dentro da instância —
 * a fusão de duplicados acontece no upsert.
 */
@Entity('identity_map')
@Index(['instanceId', 'lid'], { unique: true, where: '"lid" IS NOT NULL' })
@Index(['instanceId', 'pnJid'], { unique: true, where: '"pnJid" IS NOT NULL' })
export class IdentityMapEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column()
  instanceId!: string;

  @Column({ type: 'varchar', nullable: true })
  lid?: string | null;

  @Column({ type: 'varchar', nullable: true })
  pnJid?: string | null;

  @Column({ type: 'varchar', nullable: true })
  phone?: string | null;

  @Column({ type: 'varchar', default: 'pn' })
  primary!: 'lid' | 'pn';

  @UpdateDateColumn()
  updatedAt!: Date;
}
