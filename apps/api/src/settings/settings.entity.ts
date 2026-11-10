import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { WamuxSettings } from '@wamux/shared';

/** Linha única de configurações globais (id fixo = 'global'). */
@Entity('settings')
export class SettingsEntity {
  @PrimaryColumn()
  id!: string;

  /** Apenas os overrides sobre os defaults do .env. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  data!: Partial<WamuxSettings>;

  @UpdateDateColumn()
  updatedAt!: Date;
}
