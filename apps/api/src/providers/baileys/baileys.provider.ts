import * as QRCode from 'qrcode';
import pino, { Logger as PinoLogger } from 'pino';
import { ProxyAgent } from 'proxy-agent';
import type { AnyMessageContent, WAMessage, WASocket } from 'baileys';
import { Readable } from 'node:stream';
import { BaseProvider, ProviderContext, QrPayload } from '../provider.interface';
import { classifyJid } from '../jid.util';
import {
  ConnectionStatus,
  CreateNewsletterInput,
  FetchMessagesOptions,
  FetchMessagesPage,
  HistoryCursor,
  Label,
  LabelTarget,
  MessageAckStatus,
  MessageType,
  NewsletterInfo,
  NormalizedEdit,
  NormalizedMessage,
  NormalizedReaction,
  NumberCheckResult,
  PollResults,
  PortableCredentials,
  PresenceInfo,
  ProviderType,
  SendButtonsInput,
  SendListInput,
  SendMediaInput,
  SendPixInput,
  SendPollInput,
  SendResult,
  SendTextInput,
  SetPresenceInput,
  UpsertLabelInput,
  WebhookEvent,
} from '../provider.types';
import {
  exportBaileysCreds,
  importBaileysCreds,
  usePostgresAuthState,
} from './baileys-auth-state';
import { loadBaileys, type BaileysModule } from './baileys-runtime';

/** Esconde user:senha na URL do proxy para não vazar credenciais no log. */
function maskProxy(url: string): string {
  return url.replace(/\/\/[^@/]+@/, '//***@');
}

/**
 * Adapter de referência (Baileys). Socket WebSocket puro, leve, sem Chromium.
 * Persiste auth no Postgres (via SessionStore) → sobrevive a restart.
 */
export class BaileysProvider extends BaseProvider {
  readonly type = ProviderType.BAILEYS;
  readonly portableCredentials = true;

  /** O que a engine de referência entrega (efetivo depende de conta Business/versão). */
  readonly capabilities = {
    labels: true,
    block: true,
    presence: true,
    fetchMessages: false, // requer store ligado ao socket
    checkNumbers: true,
    markRead: true,
    media: true,
    newsletter: true,
    history: true,
    poll: true,
    pollResults: true,
    buttons: true,
    list: true,
    pix: true,
  };

  private sock?: WASocket;
  private B!: BaileysModule;
  private destroyed = false;
  private lastQr?: QrPayload;
  private readonly waLogger: PinoLogger;

  // Loop guard de QR — política de reconexão mora no manager.
  private qrAttempts = 0;
  private readonly maxQrAttempts = Number(this.config.maxQrAttempts) || 5;
  private readonly qrTtlMs = Number(this.config.qrTtlMs) || 60_000;

  // Stores locais alimentados por evento.
  private readonly labelStore = new Map<string, Label>(); // labelId → Label
  private readonly assoc = new Map<string, Set<string>>(); // labelId → Set<jid>
  private readonly polls = new Map<string, WAMessage>(); // pollId → msg (p/ descriptografar votos)

  constructor(ctx: ProviderContext) {
    super(ctx);
    // Baileys exige um logger estilo pino; silenciamos o ruído interno dele.
    this.waLogger = pino({ level: 'silent' });
  }

  private resetInit(): void {
    this.qrAttempts = 0;
  }

  async initialize(): Promise<void> {
    if (this.sock) return; // idempotente
    this.resetInit(); // reinicia o loop guard de QR a cada (re)início
    this.destroyed = false;
    this.B = await loadBaileys();

    const { state, saveCreds } = await usePostgresAuthState(this.instanceId, this.sessionStore);

    let version: [number, number, number] | undefined;
    try {
      ({ version } = await this.B.fetchLatestBaileysVersion());
    } catch {
      /* usa a versão default embutida no Baileys */
    }

    // Identidade em "Aparelhos conectados" (configurável via painel/Settings).
    const client = (this.config.deviceClient as string) || 'WAMux';
    const browser = (this.config.deviceBrowser as string) || 'Chrome';

    // Proxy opcional por instância (anti-ban / geo). Detecta http/https/socks
    // pelo esquema da URL. Aplica no socket e no fetch de mídia.
    const proxyUrl = (this.config.proxyUrl as string)?.trim();
    const agent = proxyUrl
      ? (new ProxyAgent({ getProxyForUrl: () => proxyUrl }) as unknown as undefined)
      : undefined;
    if (proxyUrl) this.logger.log(`[${this.instanceId}] usando proxy ${maskProxy(proxyUrl)}`);

    this.sock = this.B.default({
      version,
      auth: state,
      logger: this.waLogger,
      browser: [client, browser, '1.0'],
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: true,
      ...(agent ? { agent, fetchAgent: agent } : {}),
    });

    this.sock.ev.on('creds.update', () => {
      void saveCreds();
    });
    this.registerHandlers();
    this.setStatus(ConnectionStatus.CONNECTING);
  }

  private registerHandlers(): void {
    if (!this.sock) return;

    this.sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        // Loop guard: após N QRs sem leitura, para de gerar.
        this.qrAttempts += 1;
        if (this.qrAttempts > this.maxQrAttempts) {
          this.destroyed = true; // impede a política de reconectar
          this.sock?.end(undefined);
          this.sock = undefined;
          this.lastQr = undefined;
          this.setStatus(ConnectionStatus.QR_EXPIRED, {
            reason: 'qr_expired',
            qrAttempts: this.qrAttempts,
          });
          return;
        }
        const qrImage = await QRCode.toDataURL(qr);
        const expiresAt = Date.now() + this.qrTtlMs;
        this.lastQr = { qr, qrImage, qrAttempts: this.qrAttempts, expiresAt };
        this.setStatus(ConnectionStatus.QR, {
          qr,
          qrImage,
          qrAttempts: this.qrAttempts,
          expiresAt,
        });
      }

      if (connection === 'open') {
        this.qrAttempts = 0;
        this.lastQr = undefined;
        this.setStatus(ConnectionStatus.CONNECTED, { wid: this.sock?.user?.id });
      }

      if (connection === 'close') {
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } })?.output
          ?.statusCode;

        if (statusCode === this.B.DisconnectReason.loggedOut) {
          await this.sessionStore.clear(this.instanceId);
          this.sock = undefined;
          this.setStatus(ConnectionStatus.LOGGED_OUT, { reason: 'device_removed', statusCode });
        } else if (!this.destroyed) {
          // NÃO reconecta aqui — só reporta o motivo bruto. A POLÍTICA (backoff +
          // classificação de statusCode) vive no InstanceManagerService.
          this.sock = undefined;
          this.setStatus(ConnectionStatus.CONNECTING, { reason: 'reconnecting', statusCode });
        }
      }
    });

    this.sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        // Edição de mensagem: protocolMessage MESSAGE_EDIT.
        const edited =
          msg.message?.protocolMessage?.editedMessage ?? msg.message?.editedMessage?.message;
        if (edited) {
          this.emitWebhook(WebhookEvent.MESSAGE_EDITED, {
            provider: this.type,
            instanceId: this.instanceId,
            messageId: msg.message?.protocolMessage?.key?.id ?? msg.key?.id ?? '',
            chatId: msg.key?.remoteJid ?? '',
            from: msg.key?.participant ?? msg.key?.remoteJid ?? '',
            fromMe: msg.key?.fromMe ?? false,
            text: edited.conversation ?? edited.extendedTextMessage?.text ?? '',
            timestamp: Math.floor(Date.now() / 1000),
          } satisfies NormalizedEdit);
          continue;
        }
        // Mensagem enviada pela própria conta (por aqui ou por outro aparelho).
        if (msg.key?.fromMe) {
          this.emitWebhook(WebhookEvent.MESSAGE_SENT, msg);
          continue;
        }
        const normalized = this.normalize(msg);
        if (normalized) this.emitTyped('message', normalized);
      }
    });

    this.sock.ev.on('messages.update', (updates) => {
      for (const u of updates) {
        // Voto de enquete: pollUpdates sobre a enquete original guardada.
        const pollUpdates = (u as { pollUpdates?: unknown[] }).pollUpdates;
        if (pollUpdates?.length && u.key?.id) this.handlePollVote(u.key.id, u.key.remoteJid ?? '', pollUpdates);

        const status = u.update?.status;
        if (status == null || !u.key?.id || !u.key?.remoteJid) continue;
        this.emitTyped('message.status', {
          provider: this.type,
          instanceId: this.instanceId,
          messageId: u.key.id,
          chatId: u.key.remoteJid,
          status: this.mapAck(status),
          timestamp: Math.floor(Date.now() / 1000),
        });
      }
    });

    // Reações.
    this.sock.ev.on('messages.reaction', (reactions) => {
      for (const r of reactions) {
        if (!r.key?.id || !r.key?.remoteJid) continue;
        this.emitWebhook(WebhookEvent.MESSAGE_REACTION, {
          provider: this.type,
          instanceId: this.instanceId,
          messageId: r.key.id,
          chatId: r.key.remoteJid,
          from: r.key.participant ?? r.key.remoteJid,
          fromMe: r.key.fromMe ?? false,
          emoji: r.reaction?.text ?? '',
          timestamp: Math.floor(Date.now() / 1000),
        } satisfies NormalizedReaction);
      }
    });

    // History sync → evento `history` tipado.
    this.sock.ev.on('messaging-history.set', ({ messages, isLatest, syncType }) => {
      const normalized = (messages ?? [])
        .map((m) => this.normalize(m))
        .filter((m): m is NormalizedMessage => !!m);
      this.emitTyped('history', {
        provider: this.type,
        instanceId: this.instanceId,
        messages: normalized,
        isLatest: isLatest ?? undefined,
        syncType: String(syncType ?? ''),
      });
    });

    // Cauda longa — repassa o payload cru do Baileys pro webhook (o cliente
    // recebe o dado nativo). Cada um é opt-in pelo filtro de eventos.
    this.sock.ev.on('messages.delete', (item) => this.emitWebhook(WebhookEvent.MESSAGE_DELETED, item));
    this.sock.ev.on('chats.upsert', (c) => this.emitWebhook(WebhookEvent.CHATS_UPSERT, c));
    this.sock.ev.on('chats.update', (c) => this.emitWebhook(WebhookEvent.CHATS_UPDATE, c));
    this.sock.ev.on('chats.delete', (c) => this.emitWebhook(WebhookEvent.CHATS_DELETE, c));
    this.sock.ev.on('contacts.upsert', (c) => this.emitWebhook(WebhookEvent.CONTACTS_UPSERT, c));
    this.sock.ev.on('contacts.update', (c) => this.emitWebhook(WebhookEvent.CONTACTS_UPDATE, c));
    this.sock.ev.on('groups.upsert', (g) => this.emitWebhook(WebhookEvent.GROUPS_UPSERT, g));
    this.sock.ev.on('groups.update', (g) => this.emitWebhook(WebhookEvent.GROUPS_UPDATE, g));
    this.sock.ev.on('group-participants.update', (g) =>
      this.emitWebhook(WebhookEvent.GROUP_PARTICIPANTS_UPDATE, g),
    );
    this.sock.ev.on('presence.update', (p) => this.emitWebhook(WebhookEvent.PRESENCE_UPDATE, p));
    this.sock.ev.on('call', (c) => this.emitWebhook(WebhookEvent.CALL_RECEIVED, c));
    // Labels: alimenta o store local além de emitir o webhook.
    this.sock.ev.on('labels.edit', (label) => {
      const l = label as { id: string; name?: string; color?: number; deleted?: boolean };
      this.labelStore.set(l.id, {
        id: l.id,
        name: l.name ?? '',
        color: l.color != null ? { index: l.color } : undefined,
        active: !l.deleted,
      });
      this.emitWebhook(WebhookEvent.LABELS_EDIT, label);
    });
    this.sock.ev.on('labels.association', (evt) => {
      const { association, type } = evt as {
        association?: { chatId?: string; labelId?: string };
        type?: 'add' | 'remove';
      };
      if (association?.labelId && association.chatId) {
        const set = this.assoc.get(association.labelId) ?? new Set<string>();
        if (type === 'add') set.add(association.chatId);
        else set.delete(association.chatId);
        this.assoc.set(association.labelId, set);
      }
      this.emitWebhook(WebhookEvent.LABELS_ASSOCIATION, evt);
    });
  }

  async getQRCode(): Promise<QrPayload | null> {
    if (this.status === ConnectionStatus.CONNECTED) return null;
    if (this.status === ConnectionStatus.QR_EXPIRED) return null; // exige POST /connect p/ reabrir
    if (!this.sock) await this.initialize();
    return this.lastQr ?? null;
  }

  /** Fonte local de resultados; a canônica é o PollStore (Redis). */
  async getPollResults(_pollId: string): Promise<PollResults | null> {
    return null;
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const sent = await this.socket().sendMessage(jid, {
      text: input.text,
      linkPreview: input.linkPreview === false ? null : undefined,
    } as AnyMessageContent);
    return this.result(sent, jid);
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const source = input.url ? { url: input.url } : Buffer.from(input.base64 ?? '', 'base64');

    let content: AnyMessageContent;
    switch (input.type) {
      case 'image':
        content = { image: source, caption: input.caption, mimetype: input.mimetype };
        break;
      case 'video':
        // asGif → gifPlayback; asPtv → vídeo-nota.
        content = {
          video: source,
          caption: input.caption,
          mimetype: input.mimetype,
          ...(input.asGif ? { gifPlayback: true } : {}),
          ...(input.asPtv ? { ptv: true } : {}),
        } as unknown as AnyMessageContent;
        break;
      case 'audio':
        // asPtt → mensagem de voz.
        content = {
          audio: source,
          mimetype: input.asPtt ? 'audio/ogg; codecs=opus' : input.mimetype ?? 'audio/mp4',
          ...(input.asPtt ? { ptt: true } : {}),
        } as unknown as AnyMessageContent;
        break;
      case 'document':
        content = {
          document: source,
          mimetype: input.mimetype ?? 'application/octet-stream',
          fileName: input.filename ?? 'file',
          caption: input.caption,
        };
        break;
      case 'sticker':
        content = { sticker: source, ...(input.animated ? { isAnimated: true } : {}) } as unknown as AnyMessageContent;
        break;
      default:
        throw new Error(`Tipo de mídia não suportado: ${input.type as string}`);
    }

    const sent = await this.socket().sendMessage(jid, content);
    return this.result(sent, jid);
  }

  async logout(): Promise<void> {
    this.destroyed = true;
    try {
      await this.sock?.logout();
    } catch {
      /* pode falhar se já offline */
    }
    this.sock?.end(undefined);
    this.sock = undefined;
    await this.sessionStore.clear(this.instanceId);
    this.setStatus(ConnectionStatus.LOGGED_OUT);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    this.sock?.end(undefined);
    this.sock = undefined;
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  // ── migração de credenciais (Multi-Device) ────────────────

  async exportCredentials(): Promise<PortableCredentials> {
    return exportBaileysCreds(this.sessionStore, this.instanceId);
  }

  async importCredentials(creds: PortableCredentials): Promise<void> {
    await importBaileysCreds(this.sessionStore, this.instanceId, creds);
  }

  // ── pareamento por código ────────────────────────

  async requestPairingCode(phone: string): Promise<{ code: string }> {
    if (!this.sock) await this.initialize();
    const digits = phone.replace(/\D/g, '');
    const sock = this.socket() as WASocket & {
      requestPairingCode?: (n: string) => Promise<string>;
    };
    if (!sock.requestPairingCode) throw new Error('build do Baileys sem requestPairingCode');
    const code = await sock.requestPairingCode(digits);
    this.setStatus(ConnectionStatus.PAIRING, { reason: 'pairing_code' });
    return { code };
  }

  // ── etiquetas ─────────────────────────────────────

  async listLabels(): Promise<Label[]> {
    return [...this.labelStore.values()].filter((l) => l.active !== false);
  }

  async upsertLabel(input: UpsertLabelInput): Promise<Label> {
    const sock = this.socket() as WASocket & {
      addOrEditLabel?: (l: { id?: string; name: string; color?: number }) => Promise<{ id: string }>;
    };
    if (!sock.addOrEditLabel) throw new Error('build do Baileys sem addOrEditLabel');
    const res = await sock.addOrEditLabel({
      id: input.id,
      name: input.name,
      color: input.color?.index,
    });
    const label: Label = { id: input.id ?? res.id, name: input.name, color: input.color, active: true };
    this.labelStore.set(label.id, label);
    return label;
  }

  async setLabelForTarget(labelId: string, target: LabelTarget, on: boolean): Promise<void> {
    const jid = this.toJid(target.id);
    const sock = this.socket() as WASocket & {
      addChatLabel?: (jid: string, labelId: string) => Promise<void>;
      removeChatLabel?: (jid: string, labelId: string) => Promise<void>;
    };
    if (on) await sock.addChatLabel?.(jid, labelId);
    else await sock.removeChatLabel?.(jid, labelId);
  }

  async getLabelsForTarget(target: LabelTarget): Promise<Label[]> {
    const jid = this.toJid(target.id);
    const ids = [...this.assoc.entries()].filter(([, jids]) => jids.has(jid)).map(([id]) => id);
    return ids.map((id) => this.labelStore.get(id)).filter((l): l is Label => !!l);
  }

  async getChatsForLabel(labelId: string): Promise<string[]> {
    return [...(this.assoc.get(labelId) ?? [])];
  }

  // ── conveniência ──────────────────────────────────

  async blockContact(jid: string): Promise<void> {
    await this.socket().updateBlockStatus(this.toJid(jid), 'block');
  }
  async unblockContact(jid: string): Promise<void> {
    await this.socket().updateBlockStatus(this.toJid(jid), 'unblock');
  }

  async setPresence(input: SetPresenceInput): Promise<void> {
    const jid = this.toJid(input.to);
    await this.socket().presenceSubscribe(jid);
    await this.socket().sendPresenceUpdate(input.state, jid);
    if (input.durationMs && (input.state === 'composing' || input.state === 'recording')) {
      setTimeout(() => {
        void this.socket().sendPresenceUpdate('paused', jid);
      }, input.durationMs);
    }
  }

  async getPresence(jid: string): Promise<PresenceInfo> {
    // Presença chega pelo evento presence.update (já emitido como webhook).
    await this.socket().presenceSubscribe(this.toJid(jid));
    return { chatId: this.toJid(jid) };
  }

  async checkNumbers(numbers: string[]): Promise<NumberCheckResult[]> {
    const jids = numbers.map((n) => this.toJid(n));
    const res = (await this.socket().onWhatsApp(...jids)) ?? [];
    return numbers.map((input, i) => ({
      input,
      exists: Boolean(res[i]?.exists),
      jid: res[i]?.exists ? res[i].jid : undefined,
    }));
  }

  async markRead(chatId: string, messageIds?: string[]): Promise<void> {
    const jid = this.toJid(chatId);
    const keys = (messageIds ?? []).map((id) => ({ id, remoteJid: jid, fromMe: false }));
    if (keys.length) await this.socket().readMessages(keys);
  }

  // ── mídia ─────────────────────────────────────────

  async downloadMedia(msg: NormalizedMessage): Promise<Readable | null> {
    const raw = msg.raw as WAMessage;
    if (!raw?.message) return null;
    const dl = (this.B as unknown as {
      downloadMediaMessage?: (
        m: WAMessage,
        type: 'stream',
        opts: object,
        ctx: object,
      ) => Promise<Readable>;
    }).downloadMediaMessage;
    if (!dl) return null;
    const stream = await dl(
      raw,
      'stream',
      {},
      { logger: this.waLogger, reuploadRequest: this.socket().updateMediaMessage },
    );
    return stream ?? null;
  }

  // ── newsletter / canais ───────────────────────────

  async listNewsletters(): Promise<NewsletterInfo[]> {
    const sock = this.socket() as WASocket & {
      getSubscribedNewsletters?: () => Promise<Array<Record<string, unknown>>>;
    };
    if (!sock.getSubscribedNewsletters) return [];
    const list = await sock.getSubscribedNewsletters();
    return list.map((n) => this.toNewsletter(n));
  }
  async newsletterMetadata(jid: string): Promise<NewsletterInfo> {
    const sock = this.socket() as WASocket & {
      newsletterMetadata?: (t: string, jid: string) => Promise<unknown>;
    };
    const meta = ((await sock.newsletterMetadata?.('jid', jid)) ?? { id: jid }) as Record<
      string,
      unknown
    >;
    return this.toNewsletter(meta);
  }
  async followNewsletter(jid: string): Promise<void> {
    await (this.socket() as WASocket & { newsletterFollow?: (j: string) => Promise<void> }).newsletterFollow?.(jid);
  }
  async unfollowNewsletter(jid: string): Promise<void> {
    await (this.socket() as WASocket & { newsletterUnfollow?: (j: string) => Promise<void> }).newsletterUnfollow?.(jid);
  }
  async createNewsletter(input: CreateNewsletterInput): Promise<NewsletterInfo> {
    const sock = this.socket() as WASocket & {
      newsletterCreate?: (name: string, opts: { description?: string }) => Promise<Record<string, unknown>>;
    };
    const res = (await sock.newsletterCreate?.(input.name, { description: input.description })) ?? {};
    return this.toNewsletter({ ...res, name: input.name, description: input.description });
  }

  private toNewsletter(n: Record<string, unknown>): NewsletterInfo {
    return {
      jid: String(n.id ?? n.jid ?? ''),
      name: String((n.name as string) ?? (n.threadMetadata as { name?: string })?.name ?? ''),
      description: (n.description as string) ?? undefined,
      subscriberCount: (n.subscribers as number) ?? (n.subscriberCount as number) ?? undefined,
    };
  }

  // ── interativos ───────────────────────────────────

  async sendPoll(input: SendPollInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const sent = await this.socket().sendMessage(jid, {
      poll: {
        name: input.question,
        values: input.options,
        selectableCount: input.selectableCount ?? 1,
      },
    });
    if (sent?.key?.id) this.polls.set(sent.key.id, sent);
    return this.result(sent, jid);
  }

  async sendButtons(input: SendButtonsInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const buttons = input.buttons
      .filter((b) => b.type === 'reply')
      .map((b, i) => ({
        buttonId: (b as { id?: string }).id ?? `btn_${i}`,
        buttonText: { displayText: b.title },
        type: 1,
      }));
    const sent = await this.socket().sendMessage(jid, {
      text: input.text,
      footer: input.footer,
      buttons,
      headerType: 1,
    } as unknown as AnyMessageContent);
    return this.result(sent, jid);
  }

  async sendList(input: SendListInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const sections = input.sections.map((s) => ({
      title: s.title,
      rows: s.rows.map((r) => ({ rowId: r.id, title: r.title, description: r.description })),
    }));
    const sent = await this.socket().sendMessage(jid, {
      text: input.text,
      footer: input.footer,
      title: input.title,
      buttonText: input.buttonText,
      sections,
    } as unknown as AnyMessageContent);
    return this.result(sent, jid);
  }

  async sendPix(input: SendPixInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const sent = await this.socket().sendMessage(jid, {
      interactiveMessage: {
        body: { text: input.pix.merchant },
        nativeFlowMessage: {
          buttons: [
            {
              name: 'cta_copy',
              buttonParamsJson: JSON.stringify({
                display_text: 'Copiar código PIX',
                copy_code: input.pix.code ?? input.pix.key,
              }),
            },
          ],
        },
      },
    } as unknown as AnyMessageContent);
    return this.result(sent, jid);
  }

  // ── histórico ─────────────────────────────────────

  async requestHistorySync(opts: {
    chatId?: string;
    count: number;
    before?: HistoryCursor;
  }): Promise<{ requested: boolean }> {
    if (!opts.before) return { requested: false }; // sem âncora → aguarda o recent sync
    const sock = this.socket() as WASocket & {
      fetchMessageHistory?: (count: number, key: object, ts: number) => Promise<unknown>;
    };
    if (!sock.fetchMessageHistory) return { requested: false };
    const key = { id: opts.before.id, fromMe: opts.before.fromMe, remoteJid: opts.chatId };
    await sock.fetchMessageHistory(opts.count, key, opts.before.timestamp);
    return { requested: true };
  }

  // ── helpers ───────────────────────────────────────────────

  /** Descriptografa e emite votos de enquete. */
  private handlePollVote(pollId: string, chatId: string, pollUpdates: unknown[]): void {
    const original = this.polls.get(pollId);
    if (!original?.message) return;
    const agg = (this.B as unknown as {
      getAggregateVotesInPollMessage?: (o: {
        message: unknown;
        pollUpdates: unknown[];
      }) => Array<{ name: string; voters: string[] }>;
    }).getAggregateVotesInPollMessage;
    if (!agg) return;
    const results = agg({ message: original.message, pollUpdates });
    const byVoter = new Map<string, string[]>();
    for (const opt of results) {
      for (const voter of opt.voters) {
        const arr = byVoter.get(voter) ?? [];
        arr.push(opt.name);
        byVoter.set(voter, arr);
      }
    }
    for (const [voter, selectedOptions] of byVoter) {
      this.emitTyped('poll.vote', {
        provider: this.type,
        instanceId: this.instanceId,
        pollId,
        chatId,
        voter,
        selectedOptions,
        timestamp: Math.floor(Date.now() / 1000),
      });
    }
  }

  private socket(): WASocket {
    if (!this.sock) throw new Error('Socket Baileys não inicializado (chame connect primeiro)');
    return this.sock;
  }

  private result(sent: WAMessage | undefined, jid: string): SendResult {
    // Envio pela API = evento `message.sent` (o echo de messages.upsert vem como
    // 'append' e é ignorado; o handler de 'notify' só pega envios de outro
    // aparelho). Aqui garantimos o evento para toda mensagem que nós enviamos.
    this.emitWebhook(WebhookEvent.MESSAGE_SENT, {
      key: sent?.key,
      message: sent?.message,
      to: jid,
    });
    return {
      id: sent?.key?.id ?? '',
      to: jid,
      timestamp: Math.floor(Date.now() / 1000),
      status: 'sent',
    };
  }

  private toJid(to: string): string {
    if (to.includes('@')) return to;
    const digits = to.replace(/\D/g, '');
    return `${digits}@s.whatsapp.net`;
  }

  private mapAck(status: number): MessageAckStatus {
    const S = this.B.proto.WebMessageInfo.Status;
    switch (status) {
      case S.PENDING:
        return MessageAckStatus.PENDING;
      case S.SERVER_ACK:
        return MessageAckStatus.SERVER;
      case S.DELIVERY_ACK:
        return MessageAckStatus.DELIVERED;
      case S.READ:
        return MessageAckStatus.READ;
      case S.PLAYED:
        return MessageAckStatus.PLAYED;
      default:
        return MessageAckStatus.PENDING;
    }
  }

  private normalize(msg: WAMessage): NormalizedMessage | null {
    if (!msg.message || !msg.key?.remoteJid) return null;
    const chatId = msg.key.remoteJid;
    const isGroup = chatId.endsWith('@g.us');
    const content = msg.message;

    let type = MessageType.UNKNOWN;
    let text: string | undefined;
    let media: NormalizedMessage['media'];

    if (content.conversation) {
      type = MessageType.TEXT;
      text = content.conversation;
    } else if (content.extendedTextMessage?.text) {
      type = MessageType.TEXT;
      text = content.extendedTextMessage.text;
    } else if (content.imageMessage) {
      type = MessageType.IMAGE;
      text = content.imageMessage.caption ?? undefined;
      media = { mimetype: content.imageMessage.mimetype ?? undefined, caption: text };
    } else if (content.videoMessage) {
      type = MessageType.VIDEO;
      text = content.videoMessage.caption ?? undefined;
      media = { mimetype: content.videoMessage.mimetype ?? undefined, caption: text };
    } else if (content.audioMessage) {
      type = MessageType.AUDIO;
      media = { mimetype: content.audioMessage.mimetype ?? undefined };
    } else if (content.documentMessage) {
      type = MessageType.DOCUMENT;
      media = {
        mimetype: content.documentMessage.mimetype ?? undefined,
        filename: content.documentMessage.fileName ?? undefined,
      };
    } else if (content.stickerMessage) {
      type = MessageType.STICKER;
      media = { mimetype: content.stickerMessage.mimetype ?? undefined };
    } else if (content.locationMessage) {
      type = MessageType.LOCATION;
    }

    return {
      provider: this.type,
      instanceId: this.instanceId,
      id: msg.key.id ?? '',
      chatId,
      from: msg.key.participant ?? chatId,
      fromMe: msg.key.fromMe ?? false,
      pushName: msg.pushName ?? undefined,
      isGroup,
      chatType: classifyJid(chatId),
      timestamp: Number(msg.messageTimestamp ?? 0),
      type,
      text,
      media,
      location: content.locationMessage
        ? {
            latitude: content.locationMessage.degreesLatitude ?? 0,
            longitude: content.locationMessage.degreesLongitude ?? 0,
            name: content.locationMessage.name ?? undefined,
          }
        : undefined,
      raw: msg,
    };
  }
}
