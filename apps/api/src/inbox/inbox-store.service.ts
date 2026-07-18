import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  MessageAckStatus,
  MessageStatusUpdate,
  NormalizedMessage,
  WebhookEvent,
} from '@wamux/shared';
import { ContactEntity } from './contact.entity';
import { MessageLogEntity } from '../messaging/message-log.entity';
import { WebhookPassthrough } from '../providers/provider.interface';
import { OutboundKind, OutboundPayload } from '../messaging/outbound.constants';
import { chatTypeFromJid } from './chat-type.util';
import { nextAck } from '../messaging/message-ack';
import {
  outboundMediaCaption,
  outboundMediaFilename,
  outboundMediaMimetype,
  outboundMediaUrl,
  outboundMessageType,
  previewFromInbound,
  previewFromOutbound,
  outboundRawText,
} from './preview.util';

interface OutboundInput {
  instanceId: string;
  chatId: string;
  id: string;
  kind: OutboundKind;
  payload: OutboundPayload;
  timestamp: number;
}

/**
 * Escrita do Inbox — consome o modelo canônico (nunca engine-specific),
 * gated pelas flags de `persistence` (opt-in, default off). Cada método
 * checa a flag correspondente e retorna cedo (no-op) quando desligada —
 * ver os 4 pontos de inserção em `docs/inbox-persistencia-handoff.md` §5.
 */
@Injectable()
export class InboxStoreService {
  private readonly logger = new Logger(InboxStoreService.name);

  private readonly flags: {
    contacts: boolean;
    newMessage: boolean;
    messageUpdate: boolean;
    storeMediaBody: boolean;
  };

  constructor(
    private readonly config: ConfigService,
    @InjectRepository(ContactEntity) private readonly contacts: Repository<ContactEntity>,
    @InjectRepository(MessageLogEntity) private readonly messages: Repository<MessageLogEntity>,
  ) {
    this.flags = {
      contacts: this.config.get<boolean>('persistence.contacts') ?? false,
      newMessage: this.config.get<boolean>('persistence.newMessage') ?? false,
      messageUpdate: this.config.get<boolean>('persistence.messageUpdate') ?? false,
      storeMediaBody: this.config.get<boolean>('persistence.storeMediaBody') ?? false,
    };
  }

  /**
   * Ponto §5.1 — chamado pelo `InstanceManager.onInboundMessage`, depois de
   * `messageLog.recordInbound`. Upsert de contato-chat (identidade + estado
   * de conversa) e enriquecimento de render na mensagem já logada.
   */
  async onInboundMessage(m: NormalizedMessage): Promise<void> {
    if (this.flags.contacts) await this.upsertContactFromInbound(m);
    if (this.flags.newMessage) await this.enrichMessageRender(m);
  }

  /**
   * BUG REAL achado em QA (grupo colapsando na identidade do remetente):
   * `m.pushName` é de quem MANDOU a mensagem (o participante), não do chat
   * em si. Pra 1:1 isso é correto — o remetente É o contato do chat. Pra
   * grupo/canal/broadcast, usar `m.pushName` aqui fazia a linha da lista
   * mostrar "quem falou por último" no lugar do nome do grupo (o
   * `message_logs.pushName` POR MENSAGEM já estava certo — o bug era só no
   * `ContactEntity`, que representa o CHAT, não uma mensagem). `NormalizedMessage`
   * não carrega o nome do grupo (só o do remetente) — por isso `pushName` do
   * chat, pra grupo, fica só um placeholder (jid) até `enrichFrom` (chats.upsert
   * oportunista) ou o refetch lazy de `InboxQueryService` resolverem o nome de
   * verdade via `provider.groupMetadata`.
   */
  private async upsertContactFromInbound(m: NormalizedMessage): Promise<void> {
    try {
      const type = chatTypeFromJid(m.chatId);
      const isIndividualChat = type === 'user';
      const pushName = isIndividualChat ? m.pushName?.trim() || m.chatId : m.chatId;
      const updateColumns = [
        'lastMessageId',
        'lastMessageText',
        'lastMessageType',
        'lastMessageFromMe',
        'lastMessageAt',
        // Só atualiza `pushName` no conflito pra 1:1 — pra grupo, nunca deixa um
        // remetente de mensagem pisar num nome de grupo já resolvido.
        ...(isIndividualChat ? ['pushName'] : []),
      ];
      await this.contacts
        .createQueryBuilder()
        .insert()
        .into(ContactEntity)
        .values({
          instanceId: m.instanceId,
          jid: m.chatId,
          type,
          pushName,
          lastMessageId: m.id,
          lastMessageText: previewFromInbound(m) ?? null,
          lastMessageType: m.type,
          lastMessageFromMe: false,
          lastMessageAt: m.timestamp != null ? String(m.timestamp) : null,
        })
        .orUpdate(updateColumns, ['instanceId', 'jid'])
        .execute();
      // Increment separado: atômico, não pisa em concorrência com o upsert acima
      // (upsert nunca toca unreadCount, então não há corrida entre os dois).
      await this.contacts.increment({ instanceId: m.instanceId, jid: m.chatId }, 'unreadCount', 1);
    } catch (e) {
      // Nunca derruba o fan-out por causa da persistência opt-in.
      this.logger.warn(
        `[${m.instanceId}] falha ao gravar contato-chat (inbound): ${(e as Error).message}`,
      );
    }
  }

  private async enrichMessageRender(m: NormalizedMessage): Promise<void> {
    try {
      await this.messages.update(
        { id: m.id },
        {
          pushName: m.pushName ?? null,
          // Participante de verdade em grupo (`msg.key.participant`), igual
          // ao `chatId` em 1:1 — ver comentário no `MessageLogEntity`.
          senderId: m.from || null,
          ...(this.flags.storeMediaBody ? { mediaUrl: m.media?.url ?? null } : {}),
          mediaMimetype: m.media?.mimetype ?? null,
          mediaFilename: m.media?.filename ?? null,
          mediaCaption: m.media?.caption ?? null,
          // `quotedId` não existe em NormalizedMessage (inbound) hoje — o
          // modelo canônico não carrega a referência de reply/citação
          // recebida. Só o outbound (composer) tem quotedMessageId — ver
          // onOutbound(). Gap documentado, não um bug.
        },
      );
    } catch (e) {
      this.logger.warn(
        `[${m.instanceId}] falha ao enriquecer mensagem ${m.id}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Ponto §5.2 — chamado por `MessagingService.dispatch` no mesmo lugar que
   * já chama `messageLog.recordOutbound`. Reflete o envio no chat na hora.
   */
  async onOutbound(input: OutboundInput): Promise<void> {
    if (this.flags.contacts) await this.upsertContactFromOutbound(input);
    if (this.flags.newMessage) await this.enrichOutboundRender(input);
  }

  private async upsertContactFromOutbound(input: OutboundInput): Promise<void> {
    try {
      const type = chatTypeFromJid(input.chatId);
      await this.contacts
        .createQueryBuilder()
        .insert()
        .into(ContactEntity)
        .values({
          instanceId: input.instanceId,
          jid: input.chatId,
          type,
          // Placeholder só usado se este for o PRIMEIRO contato com esse jid
          // (conversa iniciada por nós) — nunca sobrescreve um pushName real
          // já aprendido via inbound (não está na lista do orUpdate abaixo).
          pushName: input.chatId,
          lastMessageId: input.id,
          lastMessageText: previewFromOutbound(input.kind, input.payload) ?? null,
          lastMessageType: outboundMessageType(input.kind, input.payload),
          lastMessageFromMe: true,
          lastMessageAt: String(input.timestamp),
        })
        .orUpdate(
          [
            'lastMessageId',
            'lastMessageText',
            'lastMessageType',
            'lastMessageFromMe',
            'lastMessageAt',
          ],
          ['instanceId', 'jid'],
        )
        .execute();
    } catch (e) {
      this.logger.warn(
        `[${input.instanceId}] falha ao gravar contato-chat (outbound): ${(e as Error).message}`,
      );
    }
  }

  /**
   * `messageLog.recordOutbound` (pré-existente) só grava ack/auditoria —
   * nunca gravou `text`/`timestamp`/`type` de verdade (sempre ficava no
   * default da coluna: `type: 'text'` mesmo pra mídia/poll, `text`/
   * `timestamp` sempre `null`). Achado lendo a thread persistida na Fase 3 —
   * sem isso, `GET chats/:jid/messages/db` devolvia mensagens outbound
   * sem texto e com timestamp 0. `newMessage` cobre isso aqui.
   */
  private async enrichOutboundRender(input: OutboundInput): Promise<void> {
    try {
      const quotedId = (input.payload as { quotedMessageId?: string }).quotedMessageId;
      await this.messages.update(
        { id: input.id },
        {
          type: outboundMessageType(input.kind, input.payload),
          text: outboundRawText(input.kind, input.payload) ?? null,
          timestamp: input.timestamp != null ? String(input.timestamp) : null,
          ...(this.flags.storeMediaBody
            ? { mediaUrl: outboundMediaUrl(input.kind, input.payload) ?? null }
            : {}),
          mediaMimetype: outboundMediaMimetype(input.kind, input.payload) ?? null,
          mediaFilename: outboundMediaFilename(input.kind, input.payload) ?? null,
          mediaCaption: outboundMediaCaption(input.kind, input.payload) ?? null,
          quotedId: quotedId ?? null,
        },
      );
    } catch (e) {
      this.logger.warn(
        `[${input.instanceId}] falha ao enriquecer envio ${input.id}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * Ponto §5.3 — chamado junto de `messageLog.applyStatus`. Só toca o
   * contato-chat quando o status é da mensagem que É a `lastMessageId`
   * atual (denormalização de ack pra lista, sem join).
   *
   * BUG REAL achado em QA (transição não-monotônica): sem checar a
   * transição, um evento de status ATRASADO/duplicado (`server_ack` depois
   * de um `delivered` já processado — WhatsApp reemite isso em cenários
   * reais, é por isso que `messageLog.applyStatus` já usa `nextAck` pra
   * ack/auditoria) REGREDIA o ✓✓ pra ✓ na lista. Mesmo guard aplicado aqui.
   */
  async onStatus(s: MessageStatusUpdate): Promise<void> {
    if (!this.flags.messageUpdate) return;
    try {
      const contact = await this.contacts.findOne({
        where: { instanceId: s.instanceId, jid: s.chatId, lastMessageId: s.messageId },
      });
      if (!contact) return; // status de uma mensagem que não é a última do chat — nada a fazer
      const current = contact.lastMessageAck ?? MessageAckStatus.PENDING;
      const next = nextAck(current, s.status);
      if (next === current) return; // não regrediu → idempotente, sem write
      await this.contacts.update(
        { instanceId: s.instanceId, jid: s.chatId, lastMessageId: s.messageId },
        { lastMessageAck: next },
      );
    } catch (e) {
      this.logger.warn(`[${s.instanceId}] falha ao propagar ack ao chat: ${(e as Error).message}`);
    }
  }

  /**
   * Ponto §5.4 — enriquecimento OPORTUNISTA via `chats.upsert`/
   * `contacts.upsert` (hoje só Baileys emite). Bônus, não requisito — nenhum
   * outro engine depende disso. Só atualiza contatos JÁ existentes (não é
   * fonte primária, `onInboundMessage`/`onOutbound` são).
   */
  async enrichFrom(w: WebhookPassthrough): Promise<void> {
    if (!this.flags.contacts) return;
    if (w.event !== WebhookEvent.CONTACTS_UPSERT && w.event !== WebhookEvent.CHATS_UPSERT) return;
    const items = Array.isArray(w.payload) ? w.payload : [];
    for (const raw of items as Array<Record<string, unknown>>) {
      const jid = (raw.id as string) ?? (raw.jid as string);
      if (!jid) continue;
      const name = (raw.name as string) ?? (raw.verifiedName as string) ?? (raw.notify as string);
      if (!name) continue;
      try {
        await this.contacts.update(
          { instanceId: w.instanceId, jid },
          w.event === WebhookEvent.CONTACTS_UPSERT
            ? { name, verifiedName: (raw.verifiedName as string) ?? undefined }
            : { name },
        );
      } catch (e) {
        this.logger.warn(
          `[${w.instanceId}] falha no enriquecimento oportunista de ${jid}: ${(e as Error).message}`,
        );
      }
    }
  }
}
