import { Readable } from 'node:stream';
import { Client, GroupChat, RemoteAuth, Message, MessageMedia, Poll } from 'whatsapp-web.js';
import * as QRCode from 'qrcode';
import { BaseProvider, ProviderContext } from '../provider.interface';
import { classifyJid } from '../jid.util';
import { PostgresRemoteStore } from './postgres-store';
import {
  ConnectionStatus,
  CreateGroupInput,
  GroupInfo,
  GroupParticipantAction,
  GroupParticipantResult,
  GroupSetting,
  Label,
  LabelTarget,
  MessageAckStatus,
  MessageType,
  NormalizedMessage,
  NumberCheckResult,
  ProviderType,
  SendMediaInput,
  SendPollInput,
  SendResult,
  SendTextInput,
  SetPresenceInput,
} from '../provider.types';

/**
 * Adapter whatsapp-web.js. Roda o WhatsApp Web num Chromium headless
 * (Puppeteer) — mais pesado que o Baileys, um browser por instância.
 *
 * Persistência: usa `RemoteAuth` com um Store custom apoiado no nosso
 * `SessionStore` (Postgres, ver `postgres-store.ts`) — a sessão do Chromium é
 * zipada e guardada no banco, sobrevivendo a restart/redeploy sem reparear.
 */
export class WebjsProvider extends BaseProvider {
  readonly type = ProviderType.WEBJS;

  /** getLabels()/Poll existem; buttons/list foram depreciados pelo WhatsApp Web. */
  readonly capabilities = {
    labels: true,
    block: true,
    presence: true,
    fetchMessages: true,
    checkNumbers: true,
    markRead: true,
    media: true,
    poll: true,
    pollResults: true,
    groups: true,
    buttons: false,
    list: false,
    pix: false,
  };

  private client?: Client;
  private lastQr?: { qr: string; qrImage: string };
  private destroyed = false;

  constructor(ctx: ProviderContext) {
    super(ctx);
  }

  async initialize(): Promise<void> {
    if (this.client) return;
    this.destroyed = false;

    const args = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
    // Proxy opcional por instância (anti-ban / geo). O Chrome aceita só
    // scheme://host:porta no arg — credenciais (user:senha) exigiriam
    // page.authenticate, ainda não suportado aqui.
    const proxyUrl = (this.config.proxyUrl as string)?.trim();
    if (proxyUrl) {
      try {
        const u = new URL(proxyUrl);
        args.push(`--proxy-server=${u.protocol}//${u.host}`);
        if (u.username) {
          this.logger.warn(
            `[${this.instanceId}] proxy com autenticação não é suportado no webjs; use proxy sem user:senha ou allowlist de IP`,
          );
        }
      } catch {
        this.logger.warn(`[${this.instanceId}] proxyUrl inválida, ignorada`);
      }
    }

    this.client = new Client({
      authStrategy: new RemoteAuth({
        clientId: this.instanceId,
        store: new PostgresRemoteStore(this.sessionStore, this.instanceId),
        backupSyncIntervalMs: 300_000, // backup da sessão a cada 5 min (mínimo 60s)
      }),
      puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args,
      },
    });

    this.client.on('qr', async (qr) => {
      const qrImage = await QRCode.toDataURL(qr);
      this.lastQr = { qr, qrImage };
      this.setStatus(ConnectionStatus.QR, { qr, qrImage });
    });
    this.client.on('ready', () => {
      this.lastQr = undefined;
      this.setStatus(ConnectionStatus.CONNECTED, { wid: this.client?.info?.wid?._serialized });
    });
    this.client.on('disconnected', (reason) => {
      this.setStatus(ConnectionStatus.LOGGED_OUT, { reason: String(reason) });
      if (!this.destroyed) {
        // reinicializa após desconexão inesperada
        setTimeout(() => this.initialize().catch((e) => this.emitError(e as Error)), 2000);
      }
    });
    this.client.on('message', (msg) => {
      this.emitTyped('message', this.normalize(msg));
    });

    this.setStatus(ConnectionStatus.CONNECTING);
    await this.client.initialize();
  }

  async getQRCode(): Promise<{ qr: string; qrImage: string } | null> {
    if (this.status === ConnectionStatus.CONNECTED) return null;
    if (!this.client) await this.initialize();
    return this.lastQr ?? null;
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const chatId = this.toChatId(input.to);
    const sent = await this.requireClient().sendMessage(chatId, input.text);
    return { id: sent.id._serialized, to: chatId, timestamp: sent.timestamp, status: 'sent' };
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const chatId = this.toChatId(input.to);
    const media = input.url
      ? await MessageMedia.fromUrl(input.url, { unsafeMime: true })
      : new MessageMedia(
          input.mimetype ?? 'application/octet-stream',
          input.base64 ?? '',
          input.filename,
        );
    const sent = await this.requireClient().sendMessage(chatId, media, {
      caption: input.caption,
      sendMediaAsSticker: input.type === 'sticker',
    });
    return { id: sent.id._serialized, to: chatId, timestamp: sent.timestamp, status: 'sent' };
  }

  async logout(): Promise<void> {
    this.destroyed = true;
    try {
      await this.client?.logout();
    } catch {
      /* ignore */
    }
    await this.client?.destroy();
    this.client = undefined;
    await this.sessionStore.clear(this.instanceId);
    this.setStatus(ConnectionStatus.LOGGED_OUT);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.client?.destroy();
    this.client = undefined;
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  // ── helpers ───────────────────────────────────────────────

  // ── capabilities (docs 03/04/08) ───────────────────────────

  async listLabels(): Promise<Label[]> {
    const labels = await (this.requireClient() as unknown as {
      getLabels: () => Promise<Array<{ id: string; name: string; hexColor?: string }>>;
    }).getLabels();
    return labels.map((l) => ({ id: l.id, name: l.name, color: { hex: l.hexColor } }));
  }

  async setLabelForTarget(labelId: string, target: LabelTarget, on: boolean): Promise<void> {
    const c = this.requireClient() as unknown as {
      getChatById: (id: string) => Promise<{
        id: { _serialized: string };
        changeLabels: (ids: string[]) => Promise<void>;
      }>;
      getChatLabels: (id: string) => Promise<Array<{ id: string }>>;
    };
    const chat = await c.getChatById(this.toChatId(target.id));
    const current = (await c.getChatLabels(chat.id._serialized)).map((l) => l.id);
    const next = on ? [...new Set([...current, labelId])] : current.filter((id) => id !== labelId);
    await chat.changeLabels(next);
  }

  async getLabelsForTarget(target: LabelTarget): Promise<Label[]> {
    const labels = await (this.requireClient() as unknown as {
      getChatLabels: (id: string) => Promise<Array<{ id: string; name: string; hexColor?: string }>>;
    }).getChatLabels(this.toChatId(target.id));
    return labels.map((l) => ({ id: l.id, name: l.name, color: { hex: l.hexColor } }));
  }

  async getChatsForLabel(labelId: string): Promise<string[]> {
    const chats = await (this.requireClient() as unknown as {
      getChatsByLabelId: (id: string) => Promise<Array<{ id: { _serialized: string } }>>;
    }).getChatsByLabelId(labelId);
    return chats.map((c) => c.id._serialized);
  }

  async blockContact(jid: string): Promise<void> {
    const c = await this.requireClient().getContactById(this.toChatId(jid));
    await c.block();
  }
  async unblockContact(jid: string): Promise<void> {
    const c = await this.requireClient().getContactById(this.toChatId(jid));
    await c.unblock();
  }
  async setPresence(input: SetPresenceInput): Promise<void> {
    const chat = await this.requireClient().getChatById(this.toChatId(input.to));
    if (input.state === 'composing') await chat.sendStateTyping();
    else if (input.state === 'recording') await chat.sendStateRecording();
    else await chat.clearState();
  }
  async checkNumbers(numbers: string[]): Promise<NumberCheckResult[]> {
    const out: NumberCheckResult[] = [];
    for (const input of numbers) {
      const id = await this.requireClient().getNumberId(input.replace(/\D/g, ''));
      out.push({ input, exists: !!id, jid: id?._serialized });
    }
    return out;
  }
  async markRead(chatId: string): Promise<void> {
    const chat = await this.requireClient().getChatById(this.toChatId(chatId));
    await chat.sendSeen();
  }

  async sendPoll(input: SendPollInput): Promise<SendResult> {
    const chatId = this.toChatId(input.to);
    const poll = new Poll(input.question, input.options, {
      allowMultipleAnswers: (input.selectableCount ?? 1) > 1,
    } as unknown as ConstructorParameters<typeof Poll>[2]);
    const sent = await this.requireClient().sendMessage(chatId, poll);
    return {
      id: sent.id._serialized,
      to: chatId,
      timestamp: sent.timestamp,
      status: 'sent',
      ack: MessageAckStatus.PENDING,
    };
  }

  async downloadMedia(msg: NormalizedMessage): Promise<Readable | null> {
    const raw = msg.raw as Message;
    if (!raw?.hasMedia) return null;
    const m = await raw.downloadMedia();
    if (!m?.data) return null;
    return Readable.from(Buffer.from(m.data, 'base64'));
  }

  // ── grupos (gated por capabilities.groups) ─────────

  async listGroups(): Promise<GroupInfo[]> {
    const chats = await this.requireClient().getChats();
    return chats.filter((c) => c.isGroup).map((c) => this.toGroup(c as GroupChat));
  }

  async groupMetadata(jid: string): Promise<GroupInfo> {
    return this.toGroup(await this.getGroupChat(jid));
  }

  async createGroup(input: CreateGroupInput): Promise<GroupInfo> {
    const res = await this.requireClient().createGroup(input.subject, input.participants);
    // createGroup devolve uma string (mensagem de erro) quando falha; senão um
    // CreateGroupResult cujo `gid` é o ChatId do grupo recém-criado.
    if (typeof res === 'string') throw new Error(`webjs: falha ao criar grupo: ${res}`);
    const gid = res.gid._serialized;
    if (input.description) {
      const chat = await this.getGroupChat(gid);
      await chat.setDescription(input.description);
    }
    return this.groupMetadata(gid);
  }

  async updateGroupParticipants(
    jid: string,
    participants: string[],
    action: GroupParticipantAction,
  ): Promise<GroupParticipantResult[]> {
    const chat = await this.getGroupChat(jid);
    // Só `add` devolve detalhe por participante (mapa id → { code }); remove/
    // promote/demote devolvem apenas um { status } agregado do lote.
    switch (action) {
      case 'add': {
        const res = await chat.addParticipants(participants);
        if (res && typeof res === 'object') {
          return Object.entries(
            res as Record<string, { code?: number; statusCode?: number }>,
          ).map(([id, r]) => ({ jid: id, status: String(r?.code ?? r?.statusCode ?? 200) }));
        }
        return participants.map((p) => ({ jid: p, status: '200' }));
      }
      case 'remove': {
        const res = await chat.removeParticipants(participants);
        return participants.map((p) => ({ jid: p, status: String(res?.status ?? 200) }));
      }
      case 'promote': {
        const res = await chat.promoteParticipants(participants);
        return participants.map((p) => ({ jid: p, status: String(res?.status ?? 200) }));
      }
      case 'demote': {
        const res = await chat.demoteParticipants(participants);
        return participants.map((p) => ({ jid: p, status: String(res?.status ?? 200) }));
      }
    }
  }

  async updateGroupSubject(jid: string, subject: string): Promise<void> {
    const chat = await this.getGroupChat(jid);
    await chat.setSubject(subject);
  }

  async updateGroupDescription(jid: string, description: string): Promise<void> {
    const chat = await this.getGroupChat(jid);
    await chat.setDescription(description);
  }

  async updateGroupSetting(jid: string, setting: GroupSetting): Promise<void> {
    const chat = await this.getGroupChat(jid);
    switch (setting) {
      case 'announcement':
        await chat.setMessagesAdminsOnly(true);
        break;
      case 'not_announcement':
        await chat.setMessagesAdminsOnly(false);
        break;
      case 'locked':
        await chat.setInfoAdminsOnly(true);
        break;
      case 'unlocked':
        await chat.setInfoAdminsOnly(false);
        break;
    }
  }

  async getGroupInviteCode(jid: string): Promise<string> {
    const chat = await this.getGroupChat(jid);
    return chat.getInviteCode();
  }

  async revokeGroupInviteCode(jid: string): Promise<string> {
    const chat = await this.getGroupChat(jid);
    // revokeInvite() resolve void na lib; buscamos o novo código gerado.
    await chat.revokeInvite();
    return chat.getInviteCode();
  }

  async joinGroupViaInvite(code: string): Promise<{ jid: string }> {
    const clean = code.replace(/^https?:\/\/chat\.whatsapp\.com\//, '').trim();
    const r = await this.requireClient().acceptInvite(clean);
    return { jid: r };
  }

  async leaveGroup(jid: string): Promise<void> {
    const chat = await this.getGroupChat(jid);
    await chat.leave();
  }

  /** Aceita jid já formatado (…@g.us) ou o id cru do grupo. */
  private toGroupJid(jid: string): string {
    return jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@g.us`;
  }

  private async getGroupChat(jid: string): Promise<GroupChat> {
    return (await this.requireClient().getChatById(this.toGroupJid(jid))) as GroupChat;
  }

  private toGroup(chat: GroupChat): GroupInfo {
    // `groupMetadata` é a model crua do WhatsApp Web (não exposta no .d.ts):
    // traz desc/announce/restrict/creation que a interface GroupChat omite.
    const meta = (
      chat as unknown as {
        groupMetadata?: { desc?: string; announce?: boolean; restrict?: boolean; creation?: number };
      }
    ).groupMetadata;
    const participants = chat.participants ?? [];
    return {
      jid: chat.id._serialized,
      subject: chat.name,
      description: meta?.desc,
      owner: chat.owner?._serialized,
      participants: participants.map((p) => ({
        id: p.id._serialized,
        role: p.isSuperAdmin ? 'superadmin' : p.isAdmin ? 'admin' : 'member',
      })),
      size: participants.length,
      announce: meta?.announce,
      restrict: meta?.restrict,
      creation: meta?.creation,
    };
  }

  private requireClient(): Client {
    if (!this.client) throw new Error('Client whatsapp-web.js não inicializado');
    return this.client;
  }

  private toChatId(to: string): string {
    if (to.includes('@')) return to;
    return `${to.replace(/\D/g, '')}@c.us`;
  }

  private normalize(msg: Message): NormalizedMessage {
    const typeMap: Record<string, MessageType> = {
      chat: MessageType.TEXT,
      image: MessageType.IMAGE,
      video: MessageType.VIDEO,
      ptt: MessageType.AUDIO,
      audio: MessageType.AUDIO,
      document: MessageType.DOCUMENT,
      sticker: MessageType.STICKER,
      location: MessageType.LOCATION,
    };
    return {
      provider: this.type,
      instanceId: this.instanceId,
      id: msg.id._serialized,
      chatId: msg.from,
      from: msg.author ?? msg.from,
      fromMe: msg.fromMe,
      pushName: undefined,
      isGroup: msg.from.endsWith('@g.us'),
      chatType: classifyJid(msg.from),
      timestamp: msg.timestamp,
      type: typeMap[msg.type] ?? MessageType.UNKNOWN,
      text: msg.body || undefined,
      media: msg.hasMedia ? {} : undefined,
      raw: msg,
    };
  }
}
