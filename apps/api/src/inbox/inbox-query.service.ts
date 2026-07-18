import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ChatMessage, ChatSummary, ContactSummary, PaginatedResult } from '@wamux/shared';
import { ContactEntity } from './contact.entity';
import { MessageLogEntity } from '../messaging/message-log.entity';
import { InstanceManagerService } from '../instance/instance-manager.service';

/** TTL do avatar persistido — depois disso, refetch lazy na próxima leitura. */
const AVATAR_TTL_MS = 24 * 60 * 60 * 1000;

export interface ListChatsOptions {
  cursor?: string;
  limit?: number;
  archived?: boolean;
  type?: string;
  q?: string;
}

export interface ListMessagesOptions {
  limit?: number;
  /** unix (s) — devolve mensagens mais antigas que isso. */
  before?: number;
}

export interface ListContactsOptions {
  cursor?: string;
  limit?: number;
  q?: string;
}

/** Leitura persistida do Inbox — sempre do DB, nunca chama o engine ao vivo. */
@Injectable()
export class InboxQueryService {
  private readonly logger = new Logger(InboxQueryService.name);

  constructor(
    @InjectRepository(ContactEntity) private readonly contacts: Repository<ContactEntity>,
    @InjectRepository(MessageLogEntity) private readonly messages: Repository<MessageLogEntity>,
    private readonly manager: InstanceManagerService,
  ) {}

  /** Lista de conversas — "Conversations" do painel. `lastMessageAt` desc. */
  async listChats(
    instanceId: string,
    opts: ListChatsOptions,
  ): Promise<PaginatedResult<ChatSummary>> {
    const limit = opts.limit ?? 30;
    const qb = this.contacts.createQueryBuilder('c').where('c."instanceId" = :instanceId', {
      instanceId,
    });
    if (opts.archived != null) qb.andWhere('c.archived = :archived', { archived: opts.archived });
    if (opts.type) qb.andWhere('c.type = :type', { type: opts.type });
    if (opts.q) {
      qb.andWhere('(c."pushName" ILIKE :q OR c.name ILIKE :q OR c.jid ILIKE :q)', {
        q: `%${opts.q}%`,
      });
    }
    if (opts.cursor) {
      qb.andWhere('c."lastMessageAt" IS NOT NULL AND c."lastMessageAt" < :cursor', {
        cursor: opts.cursor,
      });
    }
    qb.orderBy('c."lastMessageAt"', 'DESC', 'NULLS LAST')
      .addOrderBy('c.jid', 'ASC')
      .take(limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    // Fire-and-forget: lista não espera a chamada ao engine ao vivo — a
    // próxima leitura já vem com o avatar/nome fresco (evita N chamadas
    // síncronas por página, que deixariam GET /chats lento).
    this.refreshStaleAvatarsInBackground(page);
    this.refreshMissingGroupNamesInBackground(page);
    const items = page.map(toChatSummary);
    const last = items[items.length - 1];
    return {
      items,
      nextCursor: hasMore && last?.lastMessageAt != null ? String(last.lastMessageAt) : undefined,
    };
  }

  /** Thread persistida de um chat — convive com a rota ao vivo existente. */
  async listMessages(
    instanceId: string,
    chatId: string,
    opts: ListMessagesOptions,
  ): Promise<PaginatedResult<ChatMessage>> {
    const limit = opts.limit ?? 50;
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m."instanceId" = :instanceId', { instanceId })
      .andWhere('m."chatId" = :chatId', { chatId });
    if (opts.before != null) {
      qb.andWhere('m.timestamp IS NOT NULL AND CAST(m.timestamp AS bigint) < :before', {
        before: opts.before,
      });
    }
    qb.orderBy('m.timestamp', 'DESC', 'NULLS LAST').take(limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    // Foto do remetente por mensagem — só faz sentido em grupo (`senderId`
    // distinto do `chatId`; em 1:1 é o próprio chat, sem graça repetir).
    const senderIds = Array.from(
      new Set(
        page
          .filter((m) => !m.fromMe && m.senderId && m.senderId !== chatId)
          .map((m) => m.senderId as string),
      ),
    );
    const senderAvatars = await this.resolveSenderAvatars(instanceId, senderIds);

    const items = page.map((m) => toChatMessage(m, senderAvatars));
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? String(last.timestamp) : undefined };
  }

  /**
   * Avatar por remetente de mensagem de grupo — pedido explícito do usuário
   * (item 1 do bug #4): reusa `ContactEntity`/o mesmo refetch de avatar da
   * Fase 5 quando o participante JÁ tem uma linha persistida (ex.: também
   * conversa 1:1 com a conta); senão busca ao vivo via `getContactAvatar`
   * SEM persistir — `contacts` representa CHATS, não qualquer pessoa vista
   * dentro de um grupo, então não cria linha nova só por causa disso.
   */
  private async resolveSenderAvatars(
    instanceId: string,
    senderIds: string[],
  ): Promise<Map<string, string | undefined>> {
    const map = new Map<string, string | undefined>();
    if (senderIds.length === 0) return map;

    const existing = await this.contacts.find({ where: { instanceId, jid: In(senderIds) } });
    for (const c of existing) {
      if (this.isAvatarStale(c)) await this.refreshAvatar(c);
      map.set(c.jid, c.avatarUrl ?? undefined);
    }

    const missing = senderIds.filter((id) => !map.has(id));
    if (missing.length === 0) return map;
    const provider = this.manager.getLive(instanceId);
    if (!provider?.capabilities.contactAvatar || !provider.getContactAvatar) return map;
    const getContactAvatar = provider.getContactAvatar.bind(provider);
    await Promise.all(
      missing.map(async (id) => {
        try {
          map.set(id, await getContactAvatar(id));
        } catch {
          map.set(id, undefined);
        }
      }),
    );
    return map;
  }

  async listContacts(
    instanceId: string,
    opts: ListContactsOptions,
  ): Promise<PaginatedResult<ContactSummary>> {
    const limit = opts.limit ?? 30;
    const qb = this.contacts.createQueryBuilder('c').where('c."instanceId" = :instanceId', {
      instanceId,
    });
    if (opts.q) {
      qb.andWhere('(c."pushName" ILIKE :q OR c.name ILIKE :q OR c.jid ILIKE :q)', {
        q: `%${opts.q}%`,
      });
    }
    if (opts.cursor) qb.andWhere('c.jid > :cursor', { cursor: opts.cursor });
    qb.orderBy('c.jid', 'ASC').take(limit + 1);

    const rows = await qb.getMany();
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(toContactSummary);
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? last.jid : undefined };
  }

  /** Leitura de UM contato — pode se dar ao luxo de esperar o refetch (baixo volume). */
  async getContact(instanceId: string, jid: string): Promise<ContactSummary> {
    const row = await this.contacts.findOne({ where: { instanceId, jid } });
    if (!row) throw new NotFoundException(`Contato ${jid} não encontrado (persistido)`);
    if (this.isAvatarStale(row)) await this.refreshAvatar(row);
    if (this.isGroupNameMissing(row)) await this.refreshGroupName(row);
    return toContactSummary(row);
  }

  /** Zera o unread local — independente do `markRead` ao vivo (protocolo). */
  async markRead(instanceId: string, jid: string): Promise<void> {
    await this.contacts.update({ instanceId, jid }, { unreadCount: 0 });
  }

  // ── refetch de avatar (§8/§10 fase 5) ───────────────

  private isAvatarStale(c: ContactEntity): boolean {
    if (!c.avatarFetchedAt) return true;
    return Date.now() - c.avatarFetchedAt.getTime() > AVATAR_TTL_MS;
  }

  private refreshStaleAvatarsInBackground(rows: ContactEntity[]): void {
    for (const row of rows) {
      if (!this.isAvatarStale(row)) continue;
      void this.refreshAvatar(row).catch(() => {
        // best-effort — nunca deve derrubar a leitura da lista.
      });
    }
  }

  /**
   * Chama `provider.getContactAvatar` (live, best-effort) e persiste. Nunca
   * lança — provider offline/sem capability/erro de rede só mantém o
   * `avatarUrl` (ou ausência dele) como estava, sem quebrar a leitura.
   */
  private async refreshAvatar(row: ContactEntity): Promise<void> {
    const provider = this.manager.getLive(row.instanceId);
    if (!provider?.capabilities.contactAvatar || !provider.getContactAvatar) return;
    try {
      const avatarUrl = await provider.getContactAvatar(row.jid);
      const now = new Date();
      row.avatarFetchedAt = now;
      // Não apaga uma foto boa anterior por causa de um `undefined` transiente
      // (ex.: timeout) — só atualiza quando a engine devolve uma url de verdade.
      if (avatarUrl) row.avatarUrl = avatarUrl;
      await this.contacts.update(
        { instanceId: row.instanceId, jid: row.jid },
        { avatarFetchedAt: now, ...(avatarUrl ? { avatarUrl } : {}) },
      );
    } catch (e) {
      this.logger.debug(
        `[${row.instanceId}] refetch de avatar falhou pra ${row.jid}: ${(e as Error).message}`,
      );
    }
  }

  // ── refetch de nome de grupo (bug real de QA — ver InboxStoreService) ──

  /**
   * `ContactEntity.pushName` de grupo é só um placeholder (o jid) até isso
   * resolver — `NormalizedMessage` não carrega o nome do grupo, só o do
   * remetente da mensagem (ver comentário em
   * `InboxStoreService.upsertContactFromInbound`). Sem TTL — nome de grupo
   * muda raramente, então só tenta resolver uma vez; `enrichFrom`
   * (chats.upsert oportunista) cobre o caso de renomeação depois.
   */
  private isGroupNameMissing(c: ContactEntity): boolean {
    return c.type === 'group' && !c.name;
  }

  private refreshMissingGroupNamesInBackground(rows: ContactEntity[]): void {
    for (const row of rows) {
      if (!this.isGroupNameMissing(row)) continue;
      void this.refreshGroupName(row).catch(() => {
        // best-effort — nunca deve derrubar a leitura da lista.
      });
    }
  }

  private async refreshGroupName(row: ContactEntity): Promise<void> {
    const provider = this.manager.getLive(row.instanceId);
    if (!provider?.capabilities.groups || !provider.groupMetadata) return;
    try {
      const meta = await provider.groupMetadata(row.jid);
      if (!meta?.subject) return;
      row.name = meta.subject;
      await this.contacts.update(
        { instanceId: row.instanceId, jid: row.jid },
        { name: meta.subject },
      );
    } catch (e) {
      this.logger.debug(
        `[${row.instanceId}] refetch de nome do grupo falhou pra ${row.jid}: ${(e as Error).message}`,
      );
    }
  }
}

function resolveName(c: ContactEntity): string {
  return c.name || c.verifiedName || c.pushName || c.jid;
}

function toChatSummary(c: ContactEntity): ChatSummary {
  return {
    jid: c.jid,
    type: c.type,
    name: resolveName(c),
    pushName: c.pushName || undefined,
    avatarUrl: c.avatarUrl ?? undefined,
    lastMessageId: c.lastMessageId ?? undefined,
    lastMessageText: c.lastMessageText ?? undefined,
    lastMessageType: c.lastMessageType ?? undefined,
    lastMessageFromMe: c.lastMessageFromMe,
    lastMessageAck: c.lastMessageAck ?? undefined,
    lastMessageAt: c.lastMessageAt != null ? Number(c.lastMessageAt) : undefined,
    unreadCount: c.unreadCount,
    archived: c.archived,
    pinned: c.pinned,
  };
}

function toContactSummary(c: ContactEntity): ContactSummary {
  return {
    jid: c.jid,
    pushName: c.pushName,
    name: c.name ?? undefined,
    verifiedName: c.verifiedName ?? undefined,
    isBusiness: c.isBusiness,
    avatarUrl: c.avatarUrl ?? undefined,
  };
}

function toChatMessage(
  m: MessageLogEntity,
  senderAvatars?: Map<string, string | undefined>,
): ChatMessage {
  return {
    id: m.id,
    chatId: m.chatId,
    fromMe: m.fromMe,
    type: m.type,
    text: m.text ?? undefined,
    pushName: m.pushName ?? undefined,
    senderId: m.senderId ?? undefined,
    senderAvatarUrl: m.senderId ? senderAvatars?.get(m.senderId) : undefined,
    mediaUrl: m.mediaUrl ?? undefined,
    mediaMimetype: m.mediaMimetype ?? undefined,
    mediaFilename: m.mediaFilename ?? undefined,
    mediaCaption: m.mediaCaption ?? undefined,
    quotedId: m.quotedId ?? undefined,
    reaction: m.reaction ?? undefined,
    ack: m.ack,
    timestamp: m.timestamp != null ? Number(m.timestamp) : 0,
  };
}
