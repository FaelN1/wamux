import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ConnectionStatus, ProviderType } from '../providers/provider.types';

/**
 * Metadados de uma instância (uma "conta" de WhatsApp). Define qual provider
 * ela usa, sua API key própria, config específica e destino de webhook.
 * As credenciais de auth ficam separadas em `sessions` (SessionEntity).
 */
@Entity('instances')
export class InstanceEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  name!: string;

  @Column({ type: 'varchar' })
  provider!: ProviderType;

  /** API key própria da instância (além da GLOBAL_API_KEY de admin). */
  @Column()
  apiKey!: string;

  /** Segredo HMAC para assinar as entregas de webhook. Retornável só 1x. */
  @Column({ type: 'varchar', nullable: true })
  webhookSecret?: string | null;

  /** Whitelist/blacklist de JIDs, entrada e/ou saída. Vazio = tudo passa. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  filters!: Record<string, unknown>;

  /** Política de exposição do remoteJid: phone | lid | auto. */
  @Column({ type: 'varchar', default: 'auto' })
  identityMode!: string;

  @Column({ type: 'varchar', default: ConnectionStatus.DISCONNECTED })
  status!: ConnectionStatus;

  /** número/jid conectado, quando disponível. */
  @Column({ type: 'varchar', nullable: true })
  wid?: string | null;

  /**
   * Config específica do provider. Ex.:
   *  - cloud:    { phoneNumberId, accessToken, wabaId }
   *  - whatsmeow:{ userToken }
   *  - baileys:  { printQRInTerminal }
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  config!: Record<string, unknown>;

  @Column({ type: 'varchar', nullable: true })
  webhookUrl?: string | null;

  /** filtro de eventos entregues no webhook (vazio = todos). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  webhookEvents!: string[];

  /**
   * Config de entrega de eventos por transporte (webhook + websocket +
   * rabbitmq). É a fonte única; `webhookUrl`/`webhookEvents` acima são
   * mantidos em sincronia (compat com o WebhookProcessor).
   */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  eventsConfig!: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
