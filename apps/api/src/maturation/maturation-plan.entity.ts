import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MaturationConfig, MaturationEventEntry, MaturationPlanStatus } from '@wamux/shared';

/**
 * Estado interno de execução persistido no plano (jsonb). Contadores são
 * escritos apenas pelo job `turn` (a cadeia é serial: o próximo turno só é
 * agendado quando o anterior termina); o job `ack` só anexa eventos ao feed.
 */
export interface MaturationPlanProgress {
  /** contadores por instância: total e por dia (chave YYYY-MM-DD no fuso do plano). */
  perInstance?: Record<string, { totalSent: number; byDay: Record<string, number> }>;
  /** conversa em andamento entre um par do pool (N turnos alternados). */
  conversation?: {
    a: string;
    b: string;
    remainingTurns: number;
    lastFrom?: string;
    opened: boolean;
  };
  /** feed "ao vivo" do painel — ring buffer (mais recentes primeiro). */
  events?: MaturationEventEntry[];
  /** epoch (ms) do próximo turno agendado (countdown no painel). */
  nextTurnAt?: number | null;
}

/**
 * Plano de maturação: um pool de instâncias que conversam entre si ao longo
 * de uma rampa de dias (aquecimento de chip). Ver packages/shared/maturation.
 */
@Entity('maturation_plans')
export class MaturationPlanEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column({ type: 'varchar', default: 'draft' })
  status!: MaturationPlanStatus;

  /** ids das instâncias do pool (≥ 2 para iniciar). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  instanceIds!: string[];

  @Column({ type: 'jsonb' })
  config!: MaturationConfig;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  progress!: MaturationPlanProgress;

  /** âncora da rampa; deslocada no resume para "congelar" o dia durante a pausa. */
  @Column({ type: 'timestamptz', nullable: true })
  startedAt?: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  pausedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
