import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ContactEntity } from './contact.entity';
import { MessageLogEntity } from '../messaging/message-log.entity';

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // de hora em hora — retenção é em dias, não precisa de mais frequência
const BATCH_SIZE = 1000; // evita carregar um backlog gigante de uma vez na primeira ativação

/**
 * Higiene do Inbox (§8/§10 fase 5): `persistence.retentionDays` > 0 arma um
 * expurgo periódico de `message_logs` antigas. Mesmo padrão de agendamento
 * já usado no repo (`setInterval` em `onApplicationBootstrap`, ver
 * `InstanceManagerService`'s heartbeat) — sem nova dependência
 * (`@nestjs/schedule` não é usado em nenhum outro lugar do projeto).
 *
 * `0` (default) = sem expurgo, nem arma o timer.
 */
@Injectable()
export class InboxRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(InboxRetentionService.name);
  private timer?: NodeJS.Timeout;
  private readonly retentionDays: number;

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ContactEntity) private readonly contacts: Repository<ContactEntity>,
    @InjectRepository(MessageLogEntity) private readonly messages: Repository<MessageLogEntity>,
  ) {
    this.retentionDays = this.config.get<number>('persistence.retentionDays') ?? 0;
  }

  onApplicationBootstrap(): void {
    if (this.retentionDays <= 0) return;
    this.timer = setInterval(() => {
      this.purge().catch((e) =>
        this.logger.error(`expurgo de retenção falhou: ${(e as Error).message}`),
      );
    }, CHECK_INTERVAL_MS);
    // roda uma vez já no boot — não espera 1h pro primeiro expurgo.
    void this.purge().catch((e) =>
      this.logger.error(`expurgo inicial falhou: ${(e as Error).message}`),
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Expurga mensagens mais velhas que `retentionDays` e recalcula
   * `lastMessage*` dos contatos cuja última mensagem foi removida (senão a
   * lista mostraria preview de uma mensagem que não existe mais). Em lotes
   * de `BATCH_SIZE` — evita segurar um backlog inteiro em memória de uma vez
   * na primeira ativação de uma instância com histórico grande.
   */
  async purge(): Promise<{ purged: number; recalculated: number }> {
    if (this.retentionDays <= 0) return { purged: 0, recalculated: 0 };
    const cutoff = Math.floor(Date.now() / 1000) - this.retentionDays * 86_400;
    let purged = 0;
    let recalculated = 0;

    for (;;) {
      const expiring = await this.messages
        .createQueryBuilder('m')
        .where('m.timestamp IS NOT NULL AND CAST(m.timestamp AS bigint) < :cutoff', { cutoff })
        .take(BATCH_SIZE)
        .getMany();
      if (expiring.length === 0) break;

      const expiringIds = expiring.map((m) => m.id);
      // Contatos cuja PRÓPRIA lastMessage está nesse lote — só esses
      // precisam de recálculo (os demais mantêm o preview que já tinham).
      const affected = await this.contacts.find({ where: { lastMessageId: In(expiringIds) } });

      await this.messages.delete({ id: In(expiringIds) });

      for (const contact of affected) {
        const latest = await this.messages.findOne({
          where: { instanceId: contact.instanceId, chatId: contact.jid },
          order: { timestamp: 'DESC' },
        });
        await this.contacts.update(
          { instanceId: contact.instanceId, jid: contact.jid },
          latest
            ? {
                lastMessageId: latest.id,
                lastMessageText: latest.text ?? null,
                lastMessageType: latest.type,
                lastMessageFromMe: latest.fromMe,
                lastMessageAck: latest.ack,
                lastMessageAt: latest.timestamp ?? null,
              }
            : {
                lastMessageId: null,
                lastMessageText: null,
                lastMessageType: null,
                lastMessageAck: null,
                lastMessageAt: null,
              },
        );
      }

      purged += expiringIds.length;
      recalculated += affected.length;
      if (expiring.length < BATCH_SIZE) break; // última leva
    }

    if (purged > 0) {
      this.logger.log(
        `Expurgo de retenção: ${purged} mensagens removidas, ${recalculated} chats recalculados`,
      );
    }
    return { purged, recalculated };
  }
}
