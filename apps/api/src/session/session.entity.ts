import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * Credenciais de sessão (auth) de cada provider, persistidas como pares
 * chave/valor por instância. Ex.: Baileys guarda `creds` e várias
 * `app-state-sync-key-*`; a Cloud API não usa nada disto.
 *
 * Persistir aqui é o que permite restaurar a sessão após restart/deploy sem
 * precisar reparear o QR.
 */
@Entity('sessions')
@Index(['instanceId'])
export class SessionEntity {
  @PrimaryColumn()
  instanceId!: string;

  @PrimaryColumn()
  key!: string;

  @Column('text')
  value!: string;

  @UpdateDateColumn()
  updatedAt!: Date;
}
