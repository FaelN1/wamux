import * as QRCode from 'qrcode';
import pino, { Logger as PinoLogger } from 'pino';
import { ProxyAgent } from 'proxy-agent';
import type { AnyMessageContent, BinaryNode, WAMessage, WASocket } from 'baileys';
import { Readable } from 'node:stream';
import { BaseProvider, ProviderContext, QrPayload } from '../provider.interface';
import { classifyJid } from '../jid.util';
import { mapWithConcurrency } from '../concurrency.util';
import {
  ConnectionStatus,
  CreateNewsletterInput,
  CreateGroupInput,
  GroupInfo,
  GroupParticipantAction,
  GroupParticipantResult,
  GroupSetting,
  CommunityInfo,
  CreateCommunityInput,
  CommunityAdminAction,
  CommunityLinkedGroup,
  CommunityParticipant,
  CommunityInviteProbeResult,
  UpdateCommunityImageInput,
  ProfileInfo,
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
  SendLocationInput,
  ReactMessageInput,
  EditMessageInput,
  DeleteMessageInput,
  SendPollInput,
  SendResult,
  SendTextInput,
  SetPresenceInput,
  UpsertLabelInput,
  WebhookEvent,
} from '../provider.types';
import { exportBaileysCreds, importBaileysCreds, usePostgresAuthState } from './baileys-auth-state';
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
    // Bug a montante (#2687/#2199) corrigido via patch local em
    // patches/baileys@7.0.0-rc13.patch (PR #WhiskeySockets/Baileys#2434,
    // não mergeado — testado "working" por 3 usuários independentes).
    // Ver docs/newsletter-contract-handoff.md.
    newsletterMedia: true,
    // Validado ao vivo (rodada 3) contra um canal real de teste (owned pela
    // conta de QA) — POST /:jid/message com poll voltou 201/sent, sem erro
    // nos logs. Ver docs/newsletter-contract-handoff.md.
    newsletterPoll: true,
    groups: true,
    communities: true,
    profile: true,
    contactAvatar: true,
    history: true,
    reactions: true,
    editMessage: true,
    deleteMessage: true,
    location: true,
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
  /** Sequência de invocações de `connection.update` — descarta status obsoleto (ver registerHandlers). */
  private connectionSeq = 0;

  // Stores locais alimentados por evento.
  private readonly labelStore = new Map<string, Label>(); // labelId → Label
  private readonly assoc = new Map<string, Set<string>>(); // labelId → Set<jid>
  private readonly polls = new Map<string, WAMessage>(); // pollId → msg (p/ descriptografar votos)
  private labelsResynced = false; // guard: força o re-sync de labels 1x por processo

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
      // `on('connection.update', async …)` registra UM listener, mas cada
      // emissão dispara uma invocação independente — Node NÃO serializa
      // invocações concorrentes do mesmo listener async entre emits. Sem essa
      // guarda, um evento de `qr` que ainda está no `await QRCode.toDataURL`
      // pode resolver DEPOIS de um `connection: 'open'` já ter chegado (ex.:
      // scan quase simultâneo a um refresh de QR) e sobrescrever o status de
      // volta pra "qr" mesmo já conectado (o `wid` fica certo — só o `open`
      // o seta — mas o status regride). O contador de sequência descarta
      // qualquer atualização de QR cuja invocação ficou obsoleta.
      const seq = ++this.connectionSeq;
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
        if (seq !== this.connectionSeq) return; // evento mais novo já processado — descarta o obsoleto
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
        void this.resyncLabels(); // popula labels que já existiam antes desta conexão
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
        if (pollUpdates?.length && u.key?.id)
          this.handlePollVote(u.key.id, u.key.remoteJid ?? '', pollUpdates);

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
    this.sock.ev.on('messages.delete', (item) =>
      this.emitWebhook(WebhookEvent.MESSAGE_DELETED, item),
    );
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
          mimetype: input.asPtt ? 'audio/ogg; codecs=opus' : (input.mimetype ?? 'audio/mp4'),
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
        content = {
          sticker: source,
          ...(input.animated ? { isAnimated: true } : {}),
        } as unknown as AnyMessageContent;
        break;
      default:
        throw new Error(`Tipo de mídia não suportado: ${input.type as string}`);
    }

    const sent = await this.socket().sendMessage(jid, content);
    return this.result(sent, jid);
  }

  async sendLocation(input: SendLocationInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const sent = await this.socket().sendMessage(jid, {
      location: {
        degreesLatitude: input.latitude,
        degreesLongitude: input.longitude,
        name: input.name,
        address: input.address,
      },
    });
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

  // ── perfil ────────────────────────────────────────

  /**
   * `sock.user` (getter sobre `authState.creds.me`, tipo `Contact`) traz a
   * identidade da própria conta — `.name` é o campo populado no pair-success
   * (ver `Utils/validate-connection.js`), com `.verifiedName`/`.notify` como
   * fallback pra contas em que `.name` não vem preenchido. `status` (recado)
   * não é buscado aqui — a lib não expõe isso de graça pro próprio número, só
   * via query USync mais elaborada; deixado de fora por ora.
   */
  async getProfile(): Promise<ProfileInfo> {
    const jid = this.sock?.user?.id ?? '';
    const name =
      this.sock?.user?.name ||
      this.sock?.user?.verifiedName ||
      this.sock?.user?.notify ||
      undefined;
    const profilePicUrl = await this.fetchPictureUrl(jid);
    return { jid, name, profilePicUrl };
  }

  /** Reusa o mesmo `fetchPictureUrl` privado já usado pra grupos/comunidades/perfil próprio. */
  async getContactAvatar(jid: string): Promise<string | undefined> {
    return this.fetchPictureUrl(jid);
  }

  /**
   * `sock.profilePictureUrl(jid, type)` funciona pra QUALQUER jid — usuário,
   * grupo ou comunidade (mesmo mecanismo de `getProfile`, só muda o jid).
   * Sem foto definida (ou privacidade restringindo) não é erro — devolve
   * `undefined` em vez de propagar.
   */
  private async fetchPictureUrl(jid: string): Promise<string | undefined> {
    if (!jid) return undefined;
    try {
      return await this.socket().profilePictureUrl(jid, 'image');
    } catch (e) {
      // Sem foto/privacidade restringindo NÃO é bug — mas erro de verdade
      // (jid mal formado, timeout, etc.) ficava indistinguível disso antes.
      this.logger.debug(
        `[${this.instanceId}] fetchPictureUrl(${jid}) falhou: ${(e as Error).message}`,
      );
      return undefined;
    }
  }

  /**
   * Popula `pictureUrl` numa listagem inteira com concorrência limitada — N
   * chamadas seriais seria lento demais pra contas com dezenas de grupos, mas
   * N chamadas simultâneas é uma rajada arriscada (rate-limit/anti-ban) contra
   * a mesma sessão. 6 em paralelo é um meio-termo conservador.
   */
  private async attachPictureUrls(
    items: Array<{ jid: string; pictureUrl?: string }>,
  ): Promise<void> {
    const urls = await mapWithConcurrency(items, 6, (item) => this.fetchPictureUrl(item.jid));
    items.forEach((item, i) => {
      item.pictureUrl = urls[i];
    });
  }

  // ── etiquetas ─────────────────────────────────────

  /**
   * Baileys só emite `labels.edit`/`labels.association` para MUTAÇÕES NOVAS do
   * app-state — labels que já existiam antes desta conexão nunca chegam, e o store
   * é em memória (some a cada restart). Aqui zeramos a versão da coleção `regular`
   * (onde labels e associações vivem) e forçamos um snapshot, que re-emite tudo.
   * Roda uma vez por processo, é best-effort e nunca derruba a conexão. Requer a
   * app-state-sync-key presente (que some numa migração de engine).
   */
  private async resyncLabels(): Promise<void> {
    if (this.labelsResynced || !this.sock) return;
    this.labelsResynced = true;
    try {
      await this.sock.authState.keys.set({ 'app-state-sync-version': { regular: null } });
      await this.sock.resyncAppState(['regular'], false);
      this.logger.log(`[${this.instanceId}] labels re-sincronizados (${this.labelStore.size})`);
    } catch (err) {
      this.labelsResynced = false;
      this.logger.warn(
        `[${this.instanceId}] falha ao re-sincronizar labels: ${(err as Error).message}`,
      );
    }
  }

  async listLabels(): Promise<Label[]> {
    return [...this.labelStore.values()].filter((l) => l.active !== false);
  }

  async upsertLabel(input: UpsertLabelInput): Promise<Label> {
    const sock = this.socket() as WASocket & {
      addOrEditLabel?: (l: {
        id?: string;
        name: string;
        color?: number;
      }) => Promise<{ id: string }>;
    };
    if (!sock.addOrEditLabel) throw new Error('build do Baileys sem addOrEditLabel');
    const res = await sock.addOrEditLabel({
      id: input.id,
      name: input.name,
      color: input.color?.index,
    });
    const label: Label = {
      id: input.id ?? res.id,
      name: input.name,
      color: input.color,
      active: true,
    };
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
    const dl = (
      this.B as unknown as {
        downloadMediaMessage?: (
          m: WAMessage,
          type: 'stream',
          opts: object,
          ctx: object,
        ) => Promise<Readable>;
      }
    ).downloadMediaMessage;
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

  /**
   * A lib não expõe NENHUM método público de listagem/diretório de canais
   * (só create/metadata-por-jid/follow/etc. — confirmado lendo `newsletter.js`
   * inteiro: zero `QueryIds`/`XWAPaths` de "listar", zero evento de bootstrap
   * tipo `newsletters.set`). `getSubscribedNewsletters` (usado aqui antes)
   * nunca existiu nesta lib — sempre devolvia `[]` silenciosamente. A forma
   * real de listar, confirmada por um contribuidor da lib apontando pro
   * código-fonte de verdade (WhiskeySockets/Baileys#1631), é uma query WMex
   * crua com um `query_id` não documentado/não exposto como constante
   * (`xwa2_newsletter_subscribed`) — mesmo mecanismo interno que
   * `newsletter.js` usa pra tudo, só que sem wrapper público. Como não é uma
   * API oficial, o `query_id` pode ficar obsoleto se a Meta trocar o schema
   * GraphQL (já aconteceu com outros — ver diferença de `FOLLOW`/`UNFOLLOW`
   * entre versões nos comentários da issue); se passar a falhar com erro de
   * "unknown query"/GraphQL, é isso.
   */
  async listNewsletters(): Promise<NewsletterInfo[]> {
    const raw = await this.fetchSubscribedNewsletters();
    const list = raw.map((n) => this.toNewsletter(n));
    await this.attachPictureUrls(list);
    return list;
  }

  private async fetchSubscribedNewsletters(): Promise<Record<string, unknown>[]> {
    const sock = this.socket();
    const B = this.B as unknown as {
      getBinaryNodeChild: (node: unknown, tag: string) => { content?: Buffer } | undefined;
    };
    const result = await sock.query({
      tag: 'iq',
      attrs: { id: sock.generateMessageTag(), type: 'get', to: '@s.whatsapp.net', xmlns: 'w:mex' },
      content: [
        {
          tag: 'query',
          attrs: { query_id: '6388546374527196' },
          content: Buffer.from(JSON.stringify({ variables: {} }), 'utf-8'),
        },
      ],
    } as BinaryNode);
    const child = B.getBinaryNodeChild(result, 'result');
    if (!child?.content) return [];
    const parsed = JSON.parse(child.content.toString()) as {
      errors?: Array<{ message?: string }>;
      data?: Record<string, unknown>;
    };
    if (parsed.errors?.length) {
      throw new Error(
        'Baileys: falha ao listar canais (query WMex não documentada, ver ' +
          `comentário em listNewsletters) — ${parsed.errors.map((e) => e.message).join(', ')}`,
      );
    }
    const payload = parsed.data?.xwa2_newsletter_subscribed;
    if (Array.isArray(payload)) return payload as Record<string, unknown>[];
    const nested = (payload as { newsletters?: unknown[] } | undefined)?.newsletters;
    return Array.isArray(nested) ? (nested as Record<string, unknown>[]) : [];
  }
  async newsletterMetadata(jid: string): Promise<NewsletterInfo> {
    const sock = this.socket() as WASocket & {
      newsletterMetadata?: (t: string, jid: string) => Promise<unknown>;
    };
    const meta = ((await sock.newsletterMetadata?.('jid', jid)) ?? { id: jid }) as Record<
      string,
      unknown
    >;
    const info = this.toNewsletter(meta);
    info.pictureUrl = await this.fetchPictureUrl(info.jid);
    return info;
  }
  async followNewsletter(jid: string): Promise<void> {
    await (
      this.socket() as WASocket & { newsletterFollow?: (j: string) => Promise<void> }
    ).newsletterFollow?.(jid);
  }
  async unfollowNewsletter(jid: string): Promise<void> {
    await (
      this.socket() as WASocket & { newsletterUnfollow?: (j: string) => Promise<void> }
    ).newsletterUnfollow?.(jid);
  }
  /**
   * Baileys não tem checagem de elegibilidade client-side (ao contrário do
   * webjs, que checa `isNewsletterCreationEnabled()`, ou do whatsmeow, que
   * tem `AcceptTOSNotice`) — quando a conta não pode criar canal, a lib só
   * propaga o erro cru da query GraphQL da Meta ("Bad Request", sem detalhe).
   * Sem workaround programático (ver docs/newsletter-contract-handoff.md) —
   * só troca por uma mensagem de negócio acionável.
   */
  async createNewsletter(input: CreateNewsletterInput): Promise<NewsletterInfo> {
    const sock = this.socket() as WASocket & {
      newsletterCreate?: (
        name: string,
        opts: { description?: string },
      ) => Promise<Record<string, unknown>>;
    };
    let res: Record<string, unknown>;
    try {
      res = (await sock.newsletterCreate?.(input.name, { description: input.description })) ?? {};
    } catch (err) {
      throw new Error(
        'Baileys: falha ao criar canal — a conta provavelmente ainda não está elegível para ' +
          'criar canais no WhatsApp. Crie um canal manualmente pelo app oficial do WhatsApp ' +
          `nesse número pelo menos uma vez antes de tentar de novo via API. (${(err as Error).message})`,
      );
    }
    return this.toNewsletter({ ...res, name: input.name, description: input.description });
  }

  // ── grupos ─────────────────────────────────────────

  async listGroups(): Promise<GroupInfo[]> {
    const groups = await this.socket().groupFetchAllParticipating();
    const all = Object.values(groups).map((g) =>
      this.toGroup(g as unknown as Record<string, unknown>),
    );
    await this.attachPictureUrls(all);
    return all;
  }

  async groupMetadata(jid: string): Promise<GroupInfo> {
    const meta = await this.socket().groupMetadata(this.toGroupJid(jid));
    const info = this.toGroup(meta as unknown as Record<string, unknown>);
    info.pictureUrl = await this.fetchPictureUrl(info.jid);
    return info;
  }

  async createGroup(input: CreateGroupInput): Promise<GroupInfo> {
    const meta = await this.socket().groupCreate(
      input.subject,
      input.participants.map((p) => this.toJid(p)),
    );
    if (input.description) await this.socket().groupUpdateDescription(meta.id, input.description);
    return this.groupMetadata(meta.id);
  }

  async updateGroupParticipants(
    jid: string,
    participants: string[],
    action: GroupParticipantAction,
  ): Promise<GroupParticipantResult[]> {
    const res = await this.socket().groupParticipantsUpdate(
      this.toGroupJid(jid),
      participants.map((p) => this.toJid(p)),
      action,
    );
    return res.map((r) => ({ jid: r.jid ?? '', status: String(r.status) }));
  }

  async updateGroupSubject(jid: string, subject: string): Promise<void> {
    await this.socket().groupUpdateSubject(this.toGroupJid(jid), subject);
  }

  async updateGroupDescription(jid: string, description: string): Promise<void> {
    await this.socket().groupUpdateDescription(this.toGroupJid(jid), description);
  }

  async updateGroupSetting(jid: string, setting: GroupSetting): Promise<void> {
    await this.socket().groupSettingUpdate(this.toGroupJid(jid), setting);
  }

  async getGroupInviteCode(jid: string): Promise<string> {
    return (await this.socket().groupInviteCode(this.toGroupJid(jid))) ?? '';
  }

  async revokeGroupInviteCode(jid: string): Promise<string> {
    return (await this.socket().groupRevokeInvite(this.toGroupJid(jid))) ?? '';
  }

  async joinGroupViaInvite(code: string): Promise<{ jid: string }> {
    const clean = code.replace(/^https?:\/\/chat\.whatsapp\.com\//, '').trim();
    return { jid: (await this.socket().groupAcceptInvite(clean)) ?? '' };
  }

  async leaveGroup(jid: string): Promise<void> {
    await this.socket().groupLeave(this.toGroupJid(jid));
  }

  /** Aceita jid já formatado (…@g.us) ou o id cru do grupo. */
  private toGroupJid(jid: string): string {
    return jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@g.us`;
  }

  private toGroup(g: Record<string, unknown>): GroupInfo {
    const parts =
      (g.participants as Array<{ id: string; admin?: string | null }> | undefined) ?? [];
    return {
      jid: String(g.id ?? ''),
      subject: String(g.subject ?? ''),
      description: (g.desc as string | undefined) ?? undefined,
      owner: (g.owner as string | undefined) ?? (g.subjectOwner as string | undefined),
      participants: parts.map((p) => ({
        id: p.id,
        role: p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : 'member',
      })),
      size: (g.size as number | undefined) ?? parts.length,
      creation: g.creation as number | undefined,
      announce: (g.announce as boolean | undefined) ?? false,
      restrict: (g.restrict as boolean | undefined) ?? false,
      isCommunity: (g.isCommunity as boolean | undefined) ?? false,
    };
  }

  // ── comunidades ────────────────────────────────────
  // Comunidade = grupo-pai (`isCommunity: true`) que agrupa subgrupos vinculados
  // via `linkedParent`. A engine sempre cria automaticamente um subgrupo "Geral"
  // (tag `create_general_chat`) junto com o de anúncios — não há como desligar
  // isso na criação; ver `removeDefaultGroup` abaixo para a aproximação possível.

  /**
   * NÃO usamos `sock.communityMetadata`/`communityFetchAllParticipating`
   * (as funções "dedicadas" de comunidade da própria lib Baileys) — verificado
   * ao vivo contra o WhatsApp real que ambas são pouco confiáveis nesta versão:
   * `communityMetadata` lança um TypeError cru (`Cannot read properties of
   * undefined (reading 'attrs')`) dentro do parser `extractCommunityMetadata`,
   * que procura uma tag `<community>` na resposta — mas o servidor responde a
   * essa query com `<group>` (comunidade É um grupo com `isCommunity: true`
   * no protocolo), e o parser não é defensivo (ao contrário de
   * `extractGroupMetadata`, que trata `<group>` ausente sem quebrar). Isso é
   * determinístico, não uma questão de timing — não adianta retry.
   * `communityFetchAllParticipating` sofre do mesmo tipo de descompasso e
   * devolve lista vazia mesmo com comunidades reais participando (confirmado:
   * a mesma comunidade aparece corretamente via `groupFetchAllParticipating`).
   * Por isso usamos as funções de GRUPO (já testadas/usadas em `listGroups`/
   * `groupMetadata`) e filtramos por `isCommunity`.
   */
  async listCommunities(onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]> {
    const groups = await this.socket().groupFetchAllParticipating();
    const all = Object.values(groups)
      .filter((g) => (g as unknown as { isCommunity?: boolean }).isCommunity)
      .map((g) => this.toCommunity(g as unknown as Record<string, unknown>));
    const result = onlyOwnedOrAdmin ? all.filter((c) => this.isOwnedOrAdmin(c)) : all;
    await this.attachPictureUrls(result);
    return result;
  }

  /**
   * SEMPRE resolve `announcementGroupJid`/`defaultGroupJid` (via
   * `resolveLinkedGroups`) — não só na criação/sync. Bug real encontrado em
   * QA manual: `createCommunity`/`syncCommunity` resolviam esses jids só pra
   * ATRIBUIR no objeto de retorno daquela chamada, sem persistir em lugar
   * nenhum; qualquer chamada SEGUINTE a `communityMetadata` (inclusive a que
   * `sendCommunityAnnouncement` faz pra achar o grupo de anúncios) reconstruía
   * o `CommunityInfo` do zero sem os dois campos — ou seja, o sync "resolvia"
   * o anúncio, devolvia certo na resposta, mas o announcement seguinte
   * consultava de novo e vinha sem `announcementGroupJid`, sempre. Não era
   * timing — os dois caminhos de leitura simplesmente nunca convergiam.
   */
  async communityMetadata(jid: string): Promise<CommunityInfo> {
    const meta = await this.socket().groupMetadata(this.toGroupJid(jid));
    const info = this.toCommunity(meta as unknown as Record<string, unknown>);
    const [{ announcementJid, defaultGroupJid }, pictureUrl] = await Promise.all([
      this.resolveLinkedGroups(jid),
      this.fetchPictureUrl(info.jid),
    ]);
    info.announcementGroupJid = announcementJid;
    info.defaultGroupJid = defaultGroupJid;
    info.pictureUrl = pictureUrl;
    return info;
  }

  async createCommunity(input: CreateCommunityInput): Promise<CommunityInfo> {
    const meta = await this.socket().communityCreate(input.subject, input.description ?? '');
    if (!meta?.id) throw new Error('Baileys não retornou a comunidade criada');
    const jid = meta.id;

    if (input.picture) {
      try {
        await this.updateCommunityImage(jid, this.pictureToImageInput(input.picture));
      } catch (err) {
        this.logger.warn(
          `[${this.instanceId}] falha ao definir imagem da comunidade ${jid}: ${(err as Error).message}`,
        );
      }
    }

    // Descoberta é assíncrona (a engine leva um instante pra tornar os
    // subgrupos consultáveis) — por isso o evento `communities.announcement.discovered`.
    const { announcementJid, defaultGroupJid } = await this.resolveLinkedGroups(jid);
    if (announcementJid) this.emitAnnouncementDiscovered(jid, announcementJid);

    const removeDefault = input.removeDefaultGroup || input.deleteDefaultGroupChat;
    if (defaultGroupJid && input.participants?.length) {
      try {
        await this.socket().groupParticipantsUpdate(
          defaultGroupJid,
          input.participants.map((p) => this.toJid(p)),
          'add',
        );
      } catch (err) {
        this.logger.warn(
          `[${this.instanceId}] falha ao adicionar participantes iniciais na comunidade ${jid}: ${(err as Error).message}`,
        );
      }
    }
    if (defaultGroupJid && removeDefault) {
      try {
        // WhatsApp não expõe "apagar" o subgrupo padrão via multi-device — o
        // bot só consegue sair dele (ver limitação em `deleteCommunity`).
        await this.socket().groupLeave(defaultGroupJid);
      } catch (err) {
        this.logger.warn(
          `[${this.instanceId}] falha ao sair do grupo padrão da comunidade ${jid}: ${(err as Error).message}`,
        );
      }
    }

    // `communityMetadata` já resolve announcement/default sozinho (usa
    // `groupMetadata`, caminho confiável — ver comentário lá). Só corrige o
    // `defaultGroupJid` quando saímos dele acima (removeDefault).
    const info = await this.communityMetadata(jid);
    if (removeDefault) info.defaultGroupJid = undefined;
    this.emitParticipantsSynced(info);
    return info;
  }

  /**
   * WhatsApp não expõe "apagar para todos" via protocolo multi-device — nem
   * para o dono. A única operação disponível é sair da comunidade (o grupo
   * continua existindo para os demais membros). Ver limitação no README/CLAUDE.md.
   */
  async deleteCommunity(jid: string): Promise<void> {
    await this.socket().communityLeave(this.toGroupJid(jid));
  }

  async updateCommunitySubject(jid: string, subject: string): Promise<void> {
    await this.socket().communityUpdateSubject(this.toGroupJid(jid), subject);
  }

  async updateCommunityDescription(jid: string, description: string): Promise<void> {
    await this.socket().communityUpdateDescription(this.toGroupJid(jid), description);
  }

  async updateCommunityImage(jid: string, image: UpdateCommunityImageInput): Promise<void> {
    const source = image.url ? { url: image.url } : Buffer.from(image.base64 ?? '', 'base64');
    await this.socket().updateProfilePicture(this.toGroupJid(jid), source);
  }

  async updateCommunityAdmins(
    jid: string,
    members: string[],
    action: CommunityAdminAction,
  ): Promise<GroupParticipantResult[]> {
    const res = await this.socket().communityParticipantsUpdate(
      this.toGroupJid(jid),
      members.map((m) => this.toJid(m)),
      action,
    );
    return res.map((r) => ({ jid: r.jid ?? '', status: String(r.status) }));
  }

  async listCommunityMembers(jid: string): Promise<CommunityParticipant[]> {
    return (await this.communityMetadata(jid)).participants;
  }

  async countCommunityMembers(jid: string): Promise<number> {
    return (await this.communityMetadata(jid)).size;
  }

  async getCommunityInviteCode(jid: string): Promise<string> {
    return (await this.socket().communityInviteCode(this.toGroupJid(jid))) ?? '';
  }

  async revokeCommunityInviteCode(jid: string): Promise<string> {
    return (await this.socket().communityRevokeInvite(this.toGroupJid(jid))) ?? '';
  }

  /** Sonda o convite sem expor o código — só reporta se a comunidade está acessível. */
  async probeCommunityInvite(jid: string): Promise<CommunityInviteProbeResult> {
    try {
      const code = await this.socket().communityInviteCode(this.toGroupJid(jid));
      return { reachable: Boolean(code) };
    } catch {
      return { reachable: false };
    }
  }

  async listCommunityLinkedGroups(jid: string): Promise<CommunityLinkedGroup[]> {
    const { all } = await this.resolveLinkedGroups(jid, 1, 0);
    return all;
  }

  async linkGroupToCommunity(groupJid: string, communityJid: string): Promise<void> {
    await this.socket().communityLinkGroup(
      this.toGroupJid(groupJid),
      this.toGroupJid(communityJid),
    );
  }

  async unlinkGroupFromCommunity(groupJid: string, communityJid: string): Promise<void> {
    await this.socket().communityUnlinkGroup(
      this.toGroupJid(groupJid),
      this.toGroupJid(communityJid),
    );
  }

  async syncCommunity(jid: string): Promise<CommunityInfo> {
    // `communityMetadata` já resolve announcement/default sozinho — não
    // precisa resolver de novo aqui.
    const info = await this.communityMetadata(jid);
    if (info.announcementGroupJid) {
      this.emitAnnouncementDiscovered(info.jid, info.announcementGroupJid);
    }
    this.emitParticipantsSynced(info);
    return info;
  }

  async syncAllCommunities(onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]> {
    const all = await this.listCommunities(onlyOwnedOrAdmin);
    for (const info of all) this.emitParticipantsSynced(info);
    return all;
  }

  /**
   * A própria conta pode aparecer no `participants[].id` de uma comunidade
   * tanto pelo jid de telefone (`…@s.whatsapp.net`) quanto pelo LID
   * (`…@lid`) — o WhatsApp usa LID por privacidade em boa parte dos grupos
   * modernos. `sock.user` traz as duas formas (`.id` e `.lid`), então
   * comparamos contra ambas em vez de assumir uma única representação.
   */
  private isSelfParticipant(participantId: string): boolean {
    const norm = (s?: string | null) => (s ? s.replace(/:\d+(?=@)/, '') : '');
    const self = new Set([norm(this.sock?.user?.id), norm(this.sock?.user?.lid)].filter((s) => s));
    return self.has(norm(participantId));
  }

  private isOwnedOrAdmin(info: CommunityInfo): boolean {
    return info.participants.some(
      (p) => (p.role === 'admin' || p.role === 'superadmin') && this.isSelfParticipant(p.id),
    );
  }

  private pictureToImageInput(picture: string): UpdateCommunityImageInput {
    if (picture.startsWith('http://') || picture.startsWith('https://')) return { url: picture };
    const commaIndex = picture.indexOf(',');
    const base64 =
      picture.startsWith('data:') && commaIndex !== -1 ? picture.slice(commaIndex + 1) : picture;
    return { base64 };
  }

  private emitParticipantsSynced(info: CommunityInfo): void {
    this.emitWebhook(WebhookEvent.COMMUNITY_PARTICIPANTS_SYNCED, {
      communityJid: info.jid,
      name: info.subject,
      description: info.description,
      ownerJid: info.owner,
      announcementJid: info.announcementGroupJid,
      defaultSubgroupJid: info.defaultGroupJid,
      participants: info.participants.map((p) => ({
        jid: p.id,
        isAdmin: p.role === 'admin' || p.role === 'superadmin',
        isOwner: Boolean(info.owner) && p.id === info.owner,
      })),
    });
  }

  private emitAnnouncementDiscovered(communityJid: string, announcementGroupJid: string): void {
    this.emitWebhook(WebhookEvent.COMMUNITY_ANNOUNCEMENT_DISCOVERED, {
      communityJid,
      announcementGroupJid,
    });
  }

  /**
   * Resolve o subgrupo de anúncios (`isCommunityAnnounce`) e o subgrupo
   * "Geral" auto-criado pela engine. Logo após criar a comunidade, o servidor
   * pode levar um instante para tornar os subgrupos consultáveis — por isso
   * as tentativas com atraso curto (mesma estratégia usada por integrações
   * de referência contra a mesma limitação do protocolo).
   */
  private async resolveLinkedGroups(
    jid: string,
    attempts = 3,
    delayMs = 400,
  ): Promise<{ announcementJid?: string; defaultGroupJid?: string; all: CommunityLinkedGroup[] }> {
    const communityJid = this.toGroupJid(jid);
    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
      const { linkedGroups } = await this.socket().communityFetchLinkedGroups(communityJid);
      const withIds = linkedGroups.filter((g): g is typeof g & { id: string } => Boolean(g.id));
      if (!withIds.length) continue;

      const withRoles = await Promise.all(
        withIds.map(async (g) => {
          const meta = await this.socket()
            .groupMetadata(g.id)
            .catch(() => null);
          return { ...g, isAnnounce: meta?.isCommunityAnnounce ?? false };
        }),
      );

      const announce = withRoles.find((g) => g.isAnnounce);
      const general = withRoles.find((g) => !g.isAnnounce);
      if (announce || general) {
        return {
          announcementJid: announce?.id,
          defaultGroupJid: general?.id,
          all: withRoles.map((g) => ({
            jid: g.id,
            subject: g.subject,
            isAnnounce: g.isAnnounce,
            size: g.size,
          })),
        };
      }
    }
    return { all: [] };
  }

  private toCommunity(g: Record<string, unknown>): CommunityInfo {
    const parts =
      (g.participants as Array<{ id: string; admin?: string | null }> | undefined) ?? [];
    return {
      jid: String(g.id ?? ''),
      subject: String(g.subject ?? ''),
      description: (g.desc as string | undefined) ?? undefined,
      owner: (g.owner as string | undefined) ?? (g.subjectOwner as string | undefined),
      participants: parts.map((p) => ({
        id: p.id,
        role: p.admin === 'superadmin' ? 'superadmin' : p.admin === 'admin' ? 'admin' : 'member',
      })),
      size: (g.size as number | undefined) ?? parts.length,
      creation: g.creation as number | undefined,
      announce: (g.announce as boolean | undefined) ?? false,
      restrict: (g.restrict as boolean | undefined) ?? false,
    };
  }

  /**
   * A resposta real da API (confirmado em WhiskeySockets/Baileys#2204, com
   * exemplo de payload real) vem ANINHADA (`thread_metadata.name.text`,
   * `thread_metadata.subscribers_count` como STRING, `viewer_metadata.role`/
   * `.mute`) — não achatada como o tipo `NewsletterMetadata` da lib declara.
   * `parseNewsletterCreateResponse` (usado só em `createNewsletter`) já
   * achata isso antes de chegar aqui; `newsletterMetadata`/a query crua de
   * listagem não achatam — por isso os dois formatos são lidos aqui.
   */
  private toNewsletter(n: Record<string, unknown>): NewsletterInfo {
    const thread = (n.thread_metadata ?? n.threadMetadata) as Record<string, unknown> | undefined;
    const viewer = (n.viewer_metadata ?? n.viewerMetadata) as Record<string, unknown> | undefined;
    const name =
      (n.name as string) || ((thread?.name as { text?: string } | undefined)?.text ?? '');
    const description =
      (n.description as string) ||
      (thread?.description as { text?: string } | undefined)?.text ||
      undefined;
    const subscriberCountRaw = n.subscribers ?? n.subscriberCount ?? thread?.subscribers_count;
    const subscriberCount =
      typeof subscriberCountRaw === 'string'
        ? parseInt(subscriberCountRaw, 10)
        : (subscriberCountRaw as number | undefined);
    const roleRaw = ((n.role as string) ?? (viewer?.role as string))?.toLowerCase();
    const muteRaw = (n.mute_state as string) ?? (viewer?.mute as string);
    const inviteCode = ((n.invite as string) || (thread?.invite as string)) ?? undefined;
    const verificationRaw = (n.verification as string) ?? (thread?.verification as string);
    return {
      jid: String(n.id ?? n.jid ?? ''),
      name,
      description,
      subscriberCount,
      role: roleRaw as NewsletterInfo['role'],
      muted: muteRaw ? muteRaw === 'ON' : undefined,
      inviteCode: inviteCode || undefined,
      verified: verificationRaw ? verificationRaw === 'VERIFIED' : undefined,
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

  // ── ações sobre mensagens existentes ──────────────

  async reactMessage(input: ReactMessageInput): Promise<SendResult> {
    const jid = this.toJid(input.chatId);
    const key = {
      remoteJid: jid,
      id: input.messageId,
      fromMe: input.fromMe ?? false,
      ...(input.participant ? { participant: this.toJid(input.participant) } : {}),
    };
    const sent = await this.socket().sendMessage(jid, { react: { text: input.emoji, key } });
    return this.result(sent, jid);
  }

  async editMessage(input: EditMessageInput): Promise<SendResult> {
    const jid = this.toJid(input.chatId);
    const key = {
      remoteJid: jid,
      id: input.messageId,
      fromMe: input.fromMe ?? true,
      ...(input.participant ? { participant: this.toJid(input.participant) } : {}),
    };
    const sent = await this.socket().sendMessage(jid, {
      text: input.text,
      edit: key,
    } as unknown as AnyMessageContent);
    return this.result(sent, jid);
  }

  async deleteMessage(input: DeleteMessageInput): Promise<SendResult> {
    const jid = this.toJid(input.chatId);
    const key = {
      remoteJid: jid,
      id: input.messageId,
      fromMe: input.fromMe ?? true,
      ...(input.participant ? { participant: this.toJid(input.participant) } : {}),
    };
    if (input.forEveryone === false) {
      await this.socket().chatModify(
        { deleteForMe: { deleteMedia: false, key, timestamp: Date.now() } },
        jid,
      );
      return {
        id: input.messageId,
        to: jid,
        timestamp: Math.floor(Date.now() / 1000),
        status: 'sent',
      };
    }
    const sent = await this.socket().sendMessage(jid, { delete: key });
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
    const agg = (
      this.B as unknown as {
        getAggregateVotesInPollMessage?: (o: {
          message: unknown;
          pollUpdates: unknown[];
        }) => Array<{ name: string; voters: string[] }>;
      }
    ).getAggregateVotesInPollMessage;
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
