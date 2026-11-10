import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as QRCode from 'qrcode';
import {
  createNoopLogger,
  WaClient,
  type WaAuthCredentials,
  type WaGroupMetadata,
  type WaIncomingMessageEvent,
  type WaSendMessageContent,
  type WaStore,
} from 'zapo-js';
import type { CallInfo } from '@zapo-js/voip';
import { BaseProvider, ProviderContext, QrPayload } from '../provider.interface';
import { classifyJid } from '../jid.util';
import { buildVCard } from '../vcard.util';
import {
  CommunityAdminAction,
  CommunityInfo,
  CommunityInviteProbeResult,
  CommunityLinkedGroup,
  CommunityParticipant,
  CommunityParticipantRole,
  ConnectionStatus,
  CreateCommunityInput,
  CreateGroupInput,
  CreateNewsletterInput,
  DeleteMessageInput,
  EditMessageInput,
  GroupInfo,
  GroupParticipantAction,
  GroupParticipantResult,
  GroupSetting,
  MessageType,
  NewsletterInfo,
  NormalizedMessage,
  NumberCheckResult,
  PlayVoiceAudioInput,
  PortableCredentials,
  PresenceInfo,
  ProfileInfo,
  ProviderType,
  ReactMessageInput,
  SendContactInput,
  SendLocationInput,
  SendMediaInput,
  SendPollInput,
  SendResult,
  SendStatusInput,
  SendTextInput,
  SetPresenceInput,
  StartVoiceCallInput,
  UpdateCommunityImageInput,
  VoiceCallDirection,
  VoiceCallEndReason,
  VoiceCallInfo,
  VoiceCallState,
  WebhookEvent,
} from '../provider.types';
import { getZapoStore, type ZapoDbConfig, type ZapoRedisConfig } from './zapo-store';
import { importZapoCreds, toPortable, clearZapoSession } from './zapo-credentials';
import {
  loadZapoVoip,
  loadZapoMediaUtils,
  loadZapoWam,
  isVoipAvailable,
  isMediaProcessorAvailable,
} from './zapo-runtime';

/**
 * Cliente com o coordenador do plugin de VoIP anexado.
 *
 * O `WaClientEventMap` do zapo só declara os eventos do núcleo — os `voip_*`
 * são acrescentados pelo plugin via um genérico no `WaClientWithPlugins`, que
 * não sobrevive ao `new WaClient(...)` direto. Declaramos aqui a sobrecarga do
 * `on` para esses eventos, mantendo o payload tipado como `CallInfo`.
 */
type VoipEventName =
  | 'voip_call_incoming'
  | 'voip_call_state'
  | 'voip_call_ended'
  | 'voip_call_outbound_audio_finished';

type VoipClient = WaClient & {
  on(event: VoipEventName, listener: (call: CallInfo) => void): unknown;
  on(event: 'voip_call_error', listener: (error: Error) => void): unknown;
  voip?: {
    startCall(o: { peerJid: string; isVideo?: boolean; audioFile?: string }): Promise<string>;
    acceptCall(callId: string): Promise<void>;
    rejectCall(callId: string, reason?: string): Promise<void>;
    endCall(callId: string, reason?: string): Promise<void>;
    loadAudio(callId: string, path: string): Promise<void>;
    setMute(callId: string, muted: boolean): void;
    getCall(callId: string): CallInfo | null;
    getCalls(): readonly CallInfo[];
  };
};

/**
 * Adapter da engine `zapo` (`zapo-js`) — implementação independente do
 * protocolo do WhatsApp Web, com API por coordenadores (`client.message`,
 * `client.group`, `client.newsletter`, …) e persistência própria e tipada.
 *
 * Dois pontos a destacar frente às outras engines:
 *
 * 1. **Chamadas de voz reais.** Com `@zapo-js/voip` a mídia é terminada aqui
 *    dentro (Opus do WhatsApp ↔ PCM 16 kHz), não delegada a um WebRTC externo
 *    como na Calling API da Cloud. É a única engine do WAMux com `voiceCalls`.
 * 2. **Store própria.** O zapo não usa o `SessionStore` do gateway; ele tem
 *    uma camada de persistência por domínio, apontada para o MESMO Postgres
 *    com prefixo `zapo_` (ver `zapo-store.ts`). Por isso as credenciais
 *    portáveis são lidas/gravadas via `zapo-credentials.ts`, e não pelo
 *    `sessionStore` herdado da BaseProvider.
 */
export class ZapoProvider extends BaseProvider {
  readonly type = ProviderType.ZAPO;
  readonly portableCredentials = true;

  readonly capabilities = {
    block: true,
    presence: true,
    checkNumbers: true,
    markRead: true,
    media: true,
    newsletter: true,
    newsletterMedia: true,
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
    contact: true,
    status: true,
    poll: true,
    // Chamadas de voz: só quando o binário nativo do wrtc existe neste host.
    voiceCalls: isVoipAvailable(),
    voiceCallAudio: isVoipAvailable(),
    // Mídia sempre funciona; com o processador ela ganha thumbnail, dimensões,
    // waveform e detecção de mimetype (ver `mimeFor`).
    mediaProcessing: isMediaProcessorAvailable(),
    // Interativos (botões/lista/PIX) não têm builder próprio no zapo — a
    // BaseProvider responde 422 uniforme em vez de fingir suporte.
    buttons: false,
    list: false,
    pix: false,
    // `fetchMessages` exige paginação sobre o store de mensagens, que aqui é
    // cache de descriptografia e não histórico navegável.
    fetchMessages: false,
    labels: false,
  };

  private client?: VoipClient;
  private store?: WaStore;
  private destroyed = false;
  private lastQr?: QrPayload;
  private connecting?: Promise<void>;

  // Loop guard de QR — mesma política do Baileys (a decisão de reconectar
  // continua no InstanceManagerService).
  private qrAttempts = 0;
  private readonly maxQrAttempts = Number(this.config.maxQrAttempts) || 5;
  private readonly qrTtlMs = Number(this.config.qrTtlMs) || 60_000;

  constructor(ctx: ProviderContext) {
    super(ctx);
  }

  // ── ciclo de vida ─────────────────────────────────

  async initialize(): Promise<void> {
    if (this.client) return; // idempotente
    this.destroyed = false;
    this.qrAttempts = 0;

    // Primeira chamada cria o schema do zapo sob advisory lock — precisa
    // terminar antes de qualquer coordenador tocar o banco.
    const store = await this.getStore();
    const voip = loadZapoVoip();
    const mediaUtils = loadZapoMediaUtils();
    const wam = this.wamEnabled() ? loadZapoWam() : null;

    const plugins = [
      ...(voip
        ? [
            voip.voipPlugin({
              maxConcurrentCalls: Number(this.config.maxConcurrentCalls) || 1,
              logLevel: 'warn' as const,
            }),
          ]
        : []),
      // Telemetria `w:stats` de paridade com o WhatsApp Web (anti-fingerprint).
      // Não participa do envio/recepção — some sem efeito se falhar ao carregar.
      ...(wam ? [wam.wamPlugin()] : []),
    ];

    const client = new WaClient(
      {
        store,
        sessionId: this.instanceId,
        // Identidade em "Aparelhos conectados" (configurável no painel).
        deviceBrowser: (this.config.deviceBrowser as string) || 'chrome',
        deviceOsDisplayName: (this.config.deviceClient as string) || 'WAMux',
        // Processador de mídia: resolve mimetype por magic bytes e gera
        // thumbnail/dimensões/waveform. Sem ele a mídia sobe "crua" e chega
        // como anexo simples (ver `sendMedia` e `zapo-runtime.ts`).
        ...(mediaUtils
          ? {
              media: {
                processor: mediaUtils.createMediaProcessor(),
                generateThumbnail: true,
                generateWaveform: true,
                normalizeVoiceNote: true,
              },
            }
          : {}),
        ...(plugins.length ? { plugins } : {}),
      },
      createNoopLogger(),
    ) as VoipClient;

    this.client = client;
    this.registerHandlers(client);
    this.setStatus(ConnectionStatus.CONNECTING);

    // `connect()` só resolve depois do handshake — os eventos de QR/pareamento
    // são emitidos ENQUANTO ele roda, então não dá para await aqui sem travar
    // a rota de criação da instância. Guardamos a promise para o destroy.
    this.connecting = client.connect().catch((e: unknown) => {
      if (this.destroyed) return;
      this.emitError(e instanceof Error ? e : new Error(String(e)));
      this.setStatus(ConnectionStatus.DISCONNECTED, { reason: 'connect_failed' });
    });
  }

  private registerHandlers(client: VoipClient): void {
    client.on('auth_qr', (evt) => {
      const { qr } = evt as { qr: string; ttlMs: number };
      void this.handleQr(qr);
    });

    client.on('auth_paired', (evt) => {
      const { credentials } = evt as { credentials: WaAuthCredentials };
      this.qrAttempts = 0;
      this.lastQr = undefined;
      this.logger.log(`[${this.instanceId}] pareado como ${credentials.meJid ?? '?'}`);
    });

    client.on('connection', (evt) => {
      const e = evt as {
        status: 'open' | 'close';
        reason: string;
        code: number | null;
        isLogout: boolean;
      };
      if (e.status === 'open') {
        this.qrAttempts = 0;
        this.lastQr = undefined;
        this.setStatus(ConnectionStatus.CONNECTED, {
          wid: client.getCredentials()?.meJid,
        });
        return;
      }
      // close
      if (e.isLogout) {
        void this.getStore().then((st) => clearZapoSession(st, this.instanceId));
        this.client = undefined;
        this.setStatus(ConnectionStatus.LOGGED_OUT, {
          reason: 'device_removed',
          statusCode: e.code ?? undefined,
        });
      } else if (!this.destroyed) {
        // Não reconecta aqui — só reporta. A POLÍTICA vive no InstanceManager.
        this.client = undefined;
        this.setStatus(ConnectionStatus.CONNECTING, {
          reason: e.reason || 'reconnecting',
          statusCode: e.code ?? undefined,
        });
      }
    });

    client.on('message', (evt) => {
      const event = evt as WaIncomingMessageEvent;
      if (event.key?.fromMe) {
        this.emitWebhook(WebhookEvent.MESSAGE_SENT, event);
        return;
      }
      const normalized = this.normalize(event);
      if (normalized) this.emitTyped('message', normalized);
    });

    // Cauda longa — repassa o payload nativo do zapo pro webhook.
    client.on('receipt', (r) => this.emitWebhook(WebhookEvent.MESSAGE_STATUS, r));
    client.on('message_addon', (a) => this.emitWebhook(WebhookEvent.MESSAGE_REACTION, a));
    client.on('message_protocol', (p) => this.emitWebhook(WebhookEvent.MESSAGE_DELETED, p));
    client.on('group', (g) => this.emitWebhook(WebhookEvent.GROUPS_UPDATE, g));
    client.on('presence', (p) => this.emitWebhook(WebhookEvent.PRESENCE_UPDATE, p));
    client.on('chatstate', (c) => this.emitWebhook(WebhookEvent.PRESENCE_UPDATE, c));
    client.on('call', (c) => this.emitWebhook(WebhookEvent.CALL_RECEIVED, c));
    client.on('newsletter', (n) => this.emitWebhook(WebhookEvent.CHATS_UPDATE, n));

    this.registerVoipHandlers(client);
  }

  /** Eventos do plugin de VoIP → webhooks canônicos de chamada. */
  private registerVoipHandlers(client: VoipClient): void {
    if (!client.voip) return;

    client.on('voip_call_incoming', (c) =>
      this.emitWebhook(WebhookEvent.CALL_RECEIVED, this.toVoiceCall(c as CallInfo)),
    );
    client.on('voip_call_state', (c) =>
      this.emitWebhook(WebhookEvent.CALL_STATE, this.toVoiceCall(c as CallInfo)),
    );
    client.on('voip_call_ended', (c) =>
      this.emitWebhook(WebhookEvent.CALL_ENDED, this.toVoiceCall(c as CallInfo)),
    );
    client.on('voip_call_outbound_audio_finished', (c) =>
      this.emitWebhook(WebhookEvent.CALL_AUDIO_FINISHED, this.toVoiceCall(c as CallInfo)),
    );
    client.on('voip_call_error', (e) => {
      this.logger.warn(
        `[${this.instanceId}] erro de chamada: ${e instanceof Error ? e.message : String(e)}`,
      );
    });
  }

  private async handleQr(qr: string): Promise<void> {
    this.qrAttempts += 1;
    if (this.qrAttempts > this.maxQrAttempts) {
      this.destroyed = true; // impede a política de reconectar
      await this.client?.disconnect().catch(() => undefined);
      this.client = undefined;
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

  async getQRCode(): Promise<QrPayload | null> {
    if (this.status === ConnectionStatus.CONNECTED) return null;
    if (this.status === ConnectionStatus.QR_EXPIRED) return null; // exige POST /connect
    if (!this.client) await this.initialize();
    return this.lastQr ?? null;
  }

  async requestPairingCode(phone: string): Promise<{ code: string }> {
    if (!this.client) await this.initialize();
    const digits = phone.replace(/\D/g, '');
    const code = await this.wa().auth.requestPairingCode(digits);
    return { code };
  }

  async logout(): Promise<void> {
    this.destroyed = true;
    try {
      await this.client?.logout();
    } catch {
      /* pode falhar se já offline */
    }
    await this.client?.disconnect().catch(() => undefined);
    this.client = undefined;
    await clearZapoSession(await this.getStore(), this.instanceId);
    this.setStatus(ConnectionStatus.LOGGED_OUT);
  }

  async destroy(): Promise<void> {
    this.destroyed = true;
    await this.client?.disconnect().catch(() => undefined);
    await this.connecting?.catch(() => undefined);
    this.client = undefined;
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  /**
   * O zapo não usa o `SessionStore` do gateway, então o `sessions.clear()` do
   * manager não alcança estas credenciais — este hook fecha essa lacuna nos
   * caminhos de repareamento/logout.
   */
  async clearSession(): Promise<void> {
    await clearZapoSession(await this.getStore(), this.instanceId);
  }

  // ── migração de credenciais (Multi-Device) ────────

  async exportCredentials(): Promise<PortableCredentials> {
    // Prefere o cliente vivo; cai para o store quando a instância está parada.
    const creds =
      this.client?.getCredentials() ??
      (await (await this.getStore()).session(this.instanceId).auth.load());
    if (!creds) throw new Error('zapo: sem credenciais para exportar (instância não pareada?)');
    return toPortable(creds);
  }

  async importCredentials(creds: PortableCredentials): Promise<void> {
    await importZapoCreds(await this.getStore(), this.instanceId, creds);
  }

  // ── envio ─────────────────────────────────────────

  async sendText(input: SendTextInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const res = await this.wa().message.send(jid, {
      type: 'text',
      text: input.text,
      ...(input.linkPreview === false ? { linkPreview: false } : {}),
    });
    return this.result(res.id, jid);
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const media = input.url ?? Buffer.from(input.base64 ?? '', 'base64');

    let content: WaSendMessageContent;
    switch (input.type) {
      case 'image':
        content = {
          type: 'image',
          media,
          mimetype: this.mimeFor(input.mimetype, 'image/jpeg'),
          caption: input.caption,
        };
        break;
      case 'video':
        content = input.asPtv
          ? { type: 'ptv', media, mimetype: this.mimeFor(input.mimetype, 'video/mp4') }
          : {
              type: 'video',
              media,
              mimetype: this.mimeFor(input.mimetype, 'video/mp4'),
              caption: input.caption,
              ...(input.asGif ? { gifPlayback: true } : {}),
            };
        break;
      case 'audio':
        content = {
          type: 'audio',
          media,
          mimetype: input.asPtt ? 'audio/ogg; codecs=opus' : (input.mimetype ?? 'audio/mp4'),
          ...(input.asPtt ? { ptt: true } : {}),
        };
        break;
      case 'document':
        content = {
          type: 'document',
          media,
          mimetype: input.mimetype ?? 'application/octet-stream',
          fileName: input.filename ?? 'file',
          caption: input.caption,
        };
        break;
      case 'sticker':
        content = {
          type: 'sticker',
          media,
          mimetype: input.mimetype ?? 'image/webp',
          ...(input.animated ? { isAnimated: true } : {}),
        };
        break;
      default:
        throw new Error(`Tipo de mídia não suportado: ${input.type as string}`);
    }

    const res = await this.wa().message.send(jid, content);
    return this.result(res.id, jid);
  }

  async sendLocation(input: SendLocationInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const res = await this.wa().message.send(jid, {
      locationMessage: {
        degreesLatitude: input.latitude,
        degreesLongitude: input.longitude,
        name: input.name,
        address: input.address,
      },
    });
    return this.result(res.id, jid);
  }

  async sendContact(input: SendContactInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const vcards = input.contacts.map((c) => ({ vcard: buildVCard(c) }));
    const res = await this.wa().message.send(
      jid,
      input.contacts.length === 1
        ? { contactMessage: { displayName: input.contacts[0].fullName, ...vcards[0] } }
        : {
            contactsArrayMessage: {
              displayName: `${input.contacts.length} contatos`,
              contacts: vcards,
            },
          },
    );
    return this.result(res.id, jid);
  }

  async sendPoll(input: SendPollInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const res = await this.wa().message.send(jid, {
      type: 'poll',
      name: input.question,
      options: input.options,
      selectableCount: input.selectableCount ?? 1,
    });
    return this.result(res.id, jid);
  }

  async sendStatus(input: SendStatusInput): Promise<SendResult> {
    const STATUS_JID = 'status@broadcast';
    const media = input.url ?? Buffer.from(input.base64 ?? '', 'base64');
    let content: WaSendMessageContent;
    switch (input.type) {
      case 'text':
        content = { type: 'text', text: input.text ?? '' };
        break;
      case 'image':
        content = { type: 'image', media, mimetype: input.mimetype, caption: input.caption };
        break;
      case 'video':
        content = { type: 'video', media, mimetype: input.mimetype, caption: input.caption };
        break;
      case 'audio':
        content = {
          type: 'audio',
          media,
          mimetype: input.mimetype ?? 'audio/ogg; codecs=opus',
          ptt: true,
        };
        break;
      default:
        throw new Error(`Tipo de status não suportado: ${input.type as string}`);
    }
    const res = await this.wa().status.send({
      content,
      recipients: (input.statusJidList ?? []).map((j) => this.toJid(j)),
    } as never);
    return this.result((res as { id?: string })?.id ?? '', STATUS_JID);
  }

  // ── ações sobre mensagens existentes ──────────────

  async reactMessage(input: ReactMessageInput): Promise<SendResult> {
    const jid = this.toJid(input.chatId);
    const res = await this.wa().message.send(jid, {
      type: 'reaction',
      emoji: input.emoji,
      target: this.targetOf(input, jid),
    });
    return this.result(res.id, jid);
  }

  async editMessage(input: EditMessageInput): Promise<SendResult> {
    const jid = this.toJid(input.chatId);
    const res = await this.wa().message.send(jid, {
      type: 'text',
      text: input.text,
      // Só dá para editar mensagem PRÓPRIA — o alvo é sempre fromMe.
      edit: { remoteJid: jid, id: input.messageId, fromMe: true },
    } as never);
    return this.result(res.id, jid);
  }

  async deleteMessage(input: DeleteMessageInput): Promise<SendResult> {
    const jid = this.toJid(input.chatId);
    if (input.forEveryone === false) {
      // "Apagar só pra mim" é mutação de app-state, não mensagem enviada.
      await this.wa().chat.deleteMessageForMe(this.targetOf(input, jid) as never);
      return this.result(input.messageId, jid);
    }
    const res = await this.wa().message.send(jid, {
      type: 'revoke',
      target: this.targetOf(input, jid),
    });
    return this.result(res.id, jid);
  }

  async downloadMedia(msg: NormalizedMessage): Promise<Readable | null> {
    const raw = msg.raw as WaIncomingMessageEvent | undefined;
    if (!raw?.message) return null;
    try {
      return await this.wa().message.download(raw);
    } catch {
      return null;
    }
  }

  // ── conveniência ──────────────────────────────────

  async blockContact(jid: string): Promise<void> {
    await this.wa().privacy.blockUser(this.toJid(jid));
  }

  async unblockContact(jid: string): Promise<void> {
    await this.wa().privacy.unblockUser(this.toJid(jid));
  }

  async setPresence(input: SetPresenceInput): Promise<void> {
    // `available`/`unavailable` são presença GLOBAL da conta; os demais são
    // chat-state (digitando/gravando) e exigem um destino.
    if (input.state === 'available' || input.state === 'unavailable') {
      await this.wa().presence.send(input.state);
      return;
    }
    await this.wa().presence.sendChatstate(this.toJid(input.to), {
      type: input.state,
    } as never);
  }

  async getPresence(jid: string): Promise<PresenceInfo> {
    const chatId = this.toJid(jid);
    // A presença chega de forma ASSÍNCRONA pelo evento `presence`; aqui só
    // garantimos a inscrição (por jid e por conexão — refeita a cada reconnect).
    await this.wa().presence.subscribe(chatId);
    return { chatId };
  }

  async checkNumbers(numbers: string[]): Promise<NumberCheckResult[]> {
    const digits = numbers.map((n) => n.replace(/\D/g, ''));
    const found = await this.wa().profile.getLidsByPhoneNumbers(digits);
    const byPhone = new Map(
      (found ?? []).map((r) => {
        const rec = r as unknown as { phoneNumber?: string; pn?: string; lid?: string };
        return [(rec.phoneNumber ?? rec.pn ?? '').replace(/\D/g, ''), rec.lid];
      }),
    );
    return numbers.map((input, i) => {
      const lid = byPhone.get(digits[i]);
      return {
        input,
        exists: Boolean(lid),
        jid: lid ?? undefined,
      };
    });
  }

  async markRead(chatId: string, messageIds?: string[]): Promise<void> {
    if (!messageIds?.length) return;
    await this.wa().message.sendReceipt(this.toJid(chatId), messageIds, { type: 'read' } as never);
  }

  // ── perfil ────────────────────────────────────────

  async getProfile(): Promise<ProfileInfo> {
    const creds = this.wa().getCredentials();
    const jid = creds?.meJid ?? '';
    let profilePicUrl: string | undefined;
    let status: string | undefined;
    if (jid) {
      profilePicUrl = (
        await this.wa()
          .profile.getProfilePicture(jid, 'image')
          .catch(() => null)
      )?.url;
      status =
        (
          await this.wa()
            .profile.getStatus(jid)
            .catch(() => null)
        )?.status ?? undefined;
    }
    return {
      jid,
      name: creds?.meDisplayName ?? creds?.pushName,
      status,
      profilePicUrl,
    };
  }

  async getContactAvatar(jid: string): Promise<string | undefined> {
    // Sem foto / privacidade restringindo ⇒ undefined, nunca erro.
    const res = await this.wa()
      .profile.getProfilePicture(this.toJid(jid), 'preview')
      .catch(() => null);
    return res?.url;
  }

  // ── grupos ────────────────────────────────────────

  async listGroups(): Promise<GroupInfo[]> {
    const groups = await this.wa().group.queryAllGroups();
    return groups.map((g) => this.toGroup(g));
  }

  async groupMetadata(jid: string): Promise<GroupInfo> {
    return this.toGroup(await this.wa().group.queryGroupMetadata(this.toGroupJid(jid)));
  }

  async createGroup(input: CreateGroupInput): Promise<GroupInfo> {
    const meta = await this.wa().group.createGroup(
      input.subject,
      input.participants.map((p) => this.toJid(p)),
    );
    if (input.description) {
      await this.wa().group.setDescription(meta.jid, input.description);
    }
    return this.toGroup(meta);
  }

  async updateGroupParticipants(
    jid: string,
    participants: string[],
    action: GroupParticipantAction,
  ): Promise<GroupParticipantResult[]> {
    const gid = this.toGroupJid(jid);
    const jids = participants.map((p) => this.toJid(p));
    const g = this.wa().group;
    const results =
      action === 'add'
        ? await g.addParticipants(gid, jids)
        : action === 'remove'
          ? await g.removeParticipants(gid, jids)
          : action === 'promote'
            ? await g.promoteParticipants(gid, jids)
            : await g.demoteParticipants(gid, jids);
    return results.map((r) => ({ jid: r.jid, status: String(r.code) }));
  }

  async updateGroupSubject(jid: string, subject: string): Promise<void> {
    await this.wa().group.setSubject(this.toGroupJid(jid), subject);
  }

  async updateGroupDescription(jid: string, description: string): Promise<void> {
    await this.wa().group.setDescription(this.toGroupJid(jid), description);
  }

  async updateGroupSetting(jid: string, setting: GroupSetting): Promise<void> {
    const gid = this.toGroupJid(jid);
    switch (setting) {
      case 'announcement':
        return this.wa().group.setSetting(gid, 'announcement', true);
      case 'not_announcement':
        return this.wa().group.setSetting(gid, 'announcement', false);
      case 'locked':
        return this.wa().group.setSetting(gid, 'restrict', true);
      case 'unlocked':
        return this.wa().group.setSetting(gid, 'restrict', false);
    }
  }

  async getGroupInviteCode(jid: string): Promise<string> {
    return this.wa().group.queryInviteCode(this.toGroupJid(jid));
  }

  async revokeGroupInviteCode(jid: string): Promise<string> {
    const res = await this.wa().group.revokeInvite(this.toGroupJid(jid));
    return res.code;
  }

  async joinGroupViaInvite(code: string): Promise<{ jid: string }> {
    const meta = await this.wa().group.joinGroupViaInvite(code);
    return { jid: meta.jid };
  }

  async leaveGroup(jid: string): Promise<void> {
    await this.wa().group.leaveGroup([this.toGroupJid(jid)]);
  }

  // ── canais (newsletter) ───────────────────────────

  async listNewsletters(): Promise<NewsletterInfo[]> {
    const list = await this.wa().newsletter.listSubscribed();
    return list.map((n) => this.toNewsletter(n as unknown as Record<string, unknown>));
  }

  async newsletterMetadata(jid: string): Promise<NewsletterInfo> {
    const n = await this.wa().newsletter.fetch(jid);
    return this.toNewsletter(n as unknown as Record<string, unknown>);
  }

  async followNewsletter(jid: string): Promise<void> {
    await this.wa().newsletter.follow(jid);
  }

  async unfollowNewsletter(jid: string): Promise<void> {
    await this.wa().newsletter.unfollow(jid);
  }

  async createNewsletter(input: CreateNewsletterInput): Promise<NewsletterInfo> {
    const n = await this.wa().newsletter.create({
      name: input.name,
      description: input.description,
    } as never);
    return this.toNewsletter(n as unknown as Record<string, unknown>);
  }

  // ── comunidades ───────────────────────────────────
  //
  // No zapo as comunidades vivem no MESMO coordenador dos grupos — uma
  // comunidade é um grupo com `isParentGroup`. Duas diferenças relevantes
  // frente às outras engines:
  //
  // 1. `deactivateCommunity` DESATIVA de verdade. Baileys e whatsmeow só
  //    conseguem SAIR (o protocolo multi-device não expõe "apagar para
  //    todos" para eles) — ver docs/community-contract-handoff.md.
  // 2. `fetchSubGroups` devolve o grupo de anúncios direto, então não é
  //    preciso o descobrimento assíncrono com retentativas que o Baileys usa.
  //    O evento `communities.announcement.discovered` continua sendo emitido
  //    para manter o contrato de webhook idêntico entre engines.
  //
  // Métodos marcados (MEX) na doc do zapo — `fetchSubGroups` entre eles —
  // exigem transporte MEX ativo e lançam quando ele não está disponível.

  async listCommunities(onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]> {
    const groups = await this.wa().group.queryAllGroups();
    const communities = groups.filter((g) => g.isParentGroup).map((g) => this.toCommunity(g));
    return onlyOwnedOrAdmin ? communities.filter((c) => this.isOwnedOrAdmin(c)) : communities;
  }

  async communityMetadata(jid: string): Promise<CommunityInfo> {
    const communityJid = this.toGroupJid(jid);
    const info = this.toCommunity(await this.wa().group.queryGroupMetadata(communityJid));
    return this.withSubGroups(info);
  }

  async createCommunity(input: CreateCommunityInput): Promise<CommunityInfo> {
    const meta = await this.wa().group.createCommunity(input.subject, {
      description: input.description,
      // O subgrupo "Geral" só é criado quando o chamador não pede para removê-lo,
      // evitando criar e sair em seguida.
      createGeneralChat: !(input.removeDefaultGroup ?? input.deleteDefaultGroupChat),
    });

    if (input.picture) {
      await this.updateCommunityImage(meta.jid, this.pictureToImageInput(input.picture)).catch(
        (e: unknown) => this.logger.warn(`foto da comunidade falhou: ${(e as Error).message}`),
      );
    }

    const info = await this.withSubGroups(this.toCommunity(meta));

    // Participantes entram no subgrupo padrão, não no grupo-pai — é o subgrupo
    // que tem conversa. Sem subgrupo padrão (removeDefaultGroup) não há onde pôr.
    if (input.participants?.length && info.defaultGroupJid) {
      await this.updateGroupParticipants(info.defaultGroupJid, input.participants, 'add').catch(
        (e: unknown) => this.logger.warn(`participantes da comunidade: ${(e as Error).message}`),
      );
    }

    this.emitParticipantsSynced(info);
    if (info.announcementGroupJid) {
      this.emitAnnouncementDiscovered(info.jid, info.announcementGroupJid);
    }
    return info;
  }

  /** Desativação REAL — não é "sair", diferente de baileys/whatsmeow. */
  async deleteCommunity(jid: string): Promise<void> {
    await this.wa().group.deactivateCommunity(this.toGroupJid(jid));
  }

  async updateCommunitySubject(jid: string, subject: string): Promise<void> {
    await this.wa().group.setSubject(this.toGroupJid(jid), subject);
  }

  async updateCommunityDescription(jid: string, description: string): Promise<void> {
    await this.wa().group.setDescription(this.toGroupJid(jid), description);
  }

  async updateCommunityImage(jid: string, image: UpdateCommunityImageInput): Promise<void> {
    // `setProfilePicture` sobe os bytes COMO ESTÃO — o zapo não reencoda. Uma
    // imagem não quadrada ou fora de JPEG é recusada pelo servidor.
    await this.wa().profile.setProfilePicture(await this.imageBytes(image), this.toGroupJid(jid));
  }

  async updateCommunityAdmins(
    jid: string,
    members: string[],
    action: CommunityAdminAction,
  ): Promise<GroupParticipantResult[]> {
    return this.updateGroupParticipants(jid, members, action);
  }

  async listCommunityMembers(jid: string): Promise<CommunityParticipant[]> {
    const parts = await this.wa().group.queryLinkedGroupsParticipants(this.toGroupJid(jid));
    return parts.map((p) => ({ id: p.jid, role: this.roleOf(p) }));
  }

  async countCommunityMembers(jid: string): Promise<number> {
    return (await this.listCommunityMembers(jid)).length;
  }

  async getCommunityInviteCode(jid: string): Promise<string> {
    return this.wa().group.queryInviteCode(this.toGroupJid(jid));
  }

  async revokeCommunityInviteCode(jid: string): Promise<string> {
    return (await this.wa().group.revokeInvite(this.toGroupJid(jid))).code;
  }

  /** Sonda o convite SEM expor o código (liveness/anti-ban). */
  async probeCommunityInvite(jid: string): Promise<CommunityInviteProbeResult> {
    try {
      return { reachable: Boolean(await this.getCommunityInviteCode(jid)) };
    } catch {
      return { reachable: false };
    }
  }

  async listCommunityLinkedGroups(jid: string): Promise<CommunityLinkedGroup[]> {
    const res = await this.wa().group.fetchSubGroups(this.toGroupJid(jid));
    const announce = res.announcementGroup;
    return [
      ...(announce
        ? [{ jid: announce.jid, subject: announce.subject ?? '', isAnnounce: true }]
        : []),
      ...res.subGroups.map((g) => ({
        jid: g.jid,
        subject: g.subject ?? '',
        isAnnounce: false,
      })),
    ];
  }

  async linkGroupToCommunity(groupJid: string, communityJid: string): Promise<void> {
    await this.wa().group.linkSubGroups(this.toGroupJid(communityJid), [this.toGroupJid(groupJid)]);
  }

  async unlinkGroupFromCommunity(groupJid: string, communityJid: string): Promise<void> {
    await this.wa().group.unlinkSubGroups(this.toGroupJid(communityJid), [
      this.toGroupJid(groupJid),
    ]);
  }

  async syncCommunity(jid: string): Promise<CommunityInfo> {
    const info = await this.communityMetadata(jid);
    this.emitParticipantsSynced(info);
    if (info.announcementGroupJid) {
      this.emitAnnouncementDiscovered(info.jid, info.announcementGroupJid);
    }
    return info;
  }

  async syncAllCommunities(onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]> {
    const list = await this.listCommunities(onlyOwnedOrAdmin);
    const synced: CommunityInfo[] = [];
    for (const c of list) {
      // Sequencial de propósito: um lote de MEX em paralelo é o tipo de rajada
      // que o servidor throttla — e aqui não há pressa.
      synced.push(await this.syncCommunity(c.jid).catch(() => c));
    }
    return synced;
  }

  // ── chamadas de voz ───────────────────────────────

  async startVoiceCall(input: StartVoiceCallInput): Promise<VoiceCallInfo> {
    const voip = this.voip();
    const peerJid = this.toJid(input.to);
    // Áudio opcional a tocar quando a chamada for atendida — precisa estar em
    // disco porque o ffmpeg do plugin lê por caminho.
    const audioFile = input.audioUrl
      ? await this.materializeAudio({ url: input.audioUrl })
      : undefined;
    try {
      const callId = await voip.startCall({
        peerJid,
        isVideo: input.isVideo ?? false,
        ...(audioFile ? { audioFile: audioFile.path } : {}),
      });
      const call = voip.getCall(callId);
      return call
        ? this.toVoiceCall(call)
        : {
            callId,
            peerJid,
            direction: VoiceCallDirection.OUTGOING,
            state: VoiceCallState.INITIATING,
            mediaType: input.isVideo ? 'video' : 'audio',
            createdAt: Date.now(),
          };
    } finally {
      // O plugin já decodificou o arquivo em `startCall`; o temporário some.
      await audioFile?.cleanup();
    }
  }

  async acceptVoiceCall(callId: string): Promise<VoiceCallInfo> {
    const voip = this.voip();
    await voip.acceptCall(callId);
    const call = voip.getCall(callId);
    if (!call) throw new Error(`Chamada ${callId} não encontrada`);
    return this.toVoiceCall(call);
  }

  async rejectVoiceCall(callId: string, reason?: VoiceCallEndReason): Promise<void> {
    await this.voip().rejectCall(callId, reason ?? VoiceCallEndReason.DECLINED);
  }

  async endVoiceCall(callId: string, reason?: VoiceCallEndReason): Promise<void> {
    await this.voip().endCall(callId, reason ?? VoiceCallEndReason.USER_ENDED);
  }

  async setVoiceCallMute(callId: string, muted: boolean): Promise<void> {
    this.voip().setMute(callId, muted);
  }

  async playVoiceCallAudio(callId: string, input: PlayVoiceAudioInput): Promise<void> {
    const audio = await this.materializeAudio(input);
    try {
      await this.voip().loadAudio(callId, audio.path);
    } finally {
      await audio.cleanup();
    }
  }

  listVoiceCalls(): VoiceCallInfo[] {
    return this.voip()
      .getCalls()
      .map((c) => this.toVoiceCall(c));
  }

  getVoiceCall(callId: string): VoiceCallInfo | null {
    const call = this.voip().getCall(callId);
    return call ? this.toVoiceCall(call) : null;
  }

  private voip(): NonNullable<VoipClient['voip']> {
    const voip = this.wa().voip;
    if (!voip) {
      throw new Error(
        'zapo: plugin de VoIP indisponível neste host (binário nativo do @roamhq/wrtc ausente).',
      );
    }
    return voip;
  }

  /**
   * Baixa/decodifica o áudio para um arquivo temporário — `loadAudio` do
   * plugin recebe um CAMINHO (ele invoca o ffmpeg), não bytes nem URL.
   */
  private async materializeAudio(
    input: PlayVoiceAudioInput,
  ): Promise<{ path: string; cleanup: () => Promise<void> }> {
    const dir = await mkdtemp(join(tmpdir(), 'wamux-voip-'));
    const path = join(dir, `${randomUUID()}.audio`);
    const cleanup = () => rm(dir, { recursive: true, force: true }).catch(() => undefined);

    try {
      if (input.base64) {
        await writeFile(path, Buffer.from(input.base64, 'base64'));
      } else if (input.url) {
        const res = await fetch(input.url);
        if (!res.ok) throw new Error(`falha ao baixar o áudio (HTTP ${res.status})`);
        await writeFile(path, Buffer.from(await res.arrayBuffer()));
      } else {
        throw new Error('Informe "url" ou "base64" com o áudio a tocar.');
      }
    } catch (e) {
      await cleanup();
      throw e;
    }
    return { path, cleanup };
  }

  // ── helpers ───────────────────────────────────────

  /**
   * Assíncrono porque a primeira chamada cria o schema do zapo sob advisory
   * lock — ver `ensureSchema` em `zapo-store.ts`.
   */
  private async getStore(): Promise<WaStore> {
    if (!this.store) {
      const db = this.config.db as ZapoDbConfig | undefined;
      if (!db) throw new Error('zapo: configuração do banco ausente no contexto do provider');
      this.store = await getZapoStore({
        db,
        redis: this.config.redis as ZapoRedisConfig | undefined,
        useRedis: this.config.zapoStoreRedis === true,
      });
    }
    return this.store;
  }

  /**
   * Telemetria WAM ligada? Default LIGADO — o objetivo do plugin é justamente
   * a sessão não destoar de uma aba real do WhatsApp Web, então desligado ele
   * não serve para nada. Desligável por instância (`wam: false` na config) ou
   * globalmente (`ZAPO_WAM_ENABLED=false`), porque o pacote ainda está em
   * v0.1.x e um kill switch precisa existir.
   */
  private wamEnabled(): boolean {
    return this.config.wam !== false;
  }

  /**
   * Mimetype a enviar. Com o processador de mídia presente, `undefined` é a
   * resposta CERTA: o zapo detecta por magic bytes, o que é mais confiável do
   * que um palpite nosso. Sem processador o builder LANÇA para
   * image/video/audio/document/ptv sem mimetype — aí o fallback evita que
   * omitir o campo vire erro numa engine e funcione na outra.
   */
  private mimeFor(explicit: string | undefined, fallback: string): string | undefined {
    if (explicit) return explicit;
    return isMediaProcessorAvailable() ? undefined : fallback;
  }

  private wa(): VoipClient {
    if (!this.client) throw new Error('Cliente zapo não inicializado (chame connect primeiro)');
    return this.client;
  }

  private result(id: string, jid: string): SendResult {
    this.emitWebhook(WebhookEvent.MESSAGE_SENT, { id, to: jid });
    return { id, to: jid, timestamp: Math.floor(Date.now() / 1000), status: 'sent' };
  }

  private toJid(to: string): string {
    if (to.includes('@')) return to;
    return `${to.replace(/\D/g, '')}@s.whatsapp.net`;
  }

  /** `MessageRef` canônico → chave de mensagem no formato do zapo. */
  private targetOf(
    ref: { messageId: string; fromMe?: boolean; participant?: string },
    chatJid: string,
  ): { remoteJid: string; id: string; fromMe: boolean; participant?: string } {
    return {
      remoteJid: chatJid,
      id: ref.messageId,
      fromMe: ref.fromMe ?? false,
      ...(ref.participant ? { participant: this.toJid(ref.participant) } : {}),
    };
  }

  private toGroupJid(jid: string): string {
    return jid.includes('@') ? jid : `${jid.replace(/\D/g, '')}@g.us`;
  }

  private toVoiceCall(c: CallInfo): VoiceCallInfo {
    const s = c.stateData;
    return {
      callId: c.callId,
      peerJid: c.peerJid,
      direction: c.direction as unknown as VoiceCallDirection,
      state: s.state as unknown as VoiceCallState,
      mediaType: c.mediaType as unknown as 'audio' | 'video',
      createdAt: c.createdAt.getTime(),
      connectedAt: s.connectedAt?.getTime(),
      durationSecs: s.durationSecs,
      endReason: s.endReason as unknown as VoiceCallEndReason | undefined,
      muted: s.audioMuted,
      callerPhone: c.callerPn,
      acceptBlocked: s.acceptBlocked,
    };
  }

  private roleOf(p: { isAdmin: boolean; isSuperAdmin: boolean }): CommunityParticipantRole {
    return p.isSuperAdmin ? 'superadmin' : p.isAdmin ? 'admin' : 'member';
  }

  /** A própria conta é admin/superadmin desta comunidade? */
  private isOwnedOrAdmin(info: CommunityInfo): boolean {
    // Compara ignorando o sufixo de device (`:12@…`), e aceita tanto o jid de
    // telefone quanto o LID — o zapo é LID-first e o participante pode vir
    // endereçado de qualquer uma das duas formas.
    const bare = (s?: string | null) => (s ? s.replace(/:\d+(?=@)/, '') : '');
    const creds = this.client?.getCredentials();
    const self = new Set([bare(creds?.meJid), bare(creds?.meLid)].filter(Boolean));
    return info.participants.some(
      (p) => (p.role === 'admin' || p.role === 'superadmin') && self.has(bare(p.id)),
    );
  }

  /** Enriquece a comunidade com os subgrupos (anúncios e padrão). */
  private async withSubGroups(info: CommunityInfo): Promise<CommunityInfo> {
    try {
      const res = await this.wa().group.fetchSubGroups(info.jid);
      return {
        ...info,
        announcementGroupJid: res.announcementGroup?.jid,
        defaultGroupJid: res.subGroups.find((g) => g.defaultSubgroup || g.generalSubgroup)?.jid,
      };
    } catch (e) {
      // fetchSubGroups é MEX: sem esse transporte ele lança. A comunidade em si
      // continua válida — devolvemos sem os subgrupos em vez de falhar tudo.
      this.logger.warn(`[${this.instanceId}] subgrupos de ${info.jid}: ${(e as Error).message}`);
      return info;
    }
  }

  private async imageBytes(image: UpdateCommunityImageInput): Promise<Uint8Array> {
    if (image.base64) return Buffer.from(image.base64, 'base64');
    if (!image.url) throw new Error('Informe "url" ou "base64" com a imagem.');
    const res = await fetch(image.url);
    if (!res.ok) throw new Error(`falha ao baixar a imagem (HTTP ${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  /** `picture` do CreateCommunityInput aceita URL, data URI ou base64 cru. */
  private pictureToImageInput(picture: string): UpdateCommunityImageInput {
    if (picture.startsWith('http://') || picture.startsWith('https://')) return { url: picture };
    const comma = picture.indexOf(',');
    return {
      base64: picture.startsWith('data:') && comma !== -1 ? picture.slice(comma + 1) : picture,
    };
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

  private toCommunity(g: WaGroupMetadata): CommunityInfo {
    const parts = g.participants ?? [];
    return {
      jid: g.jid,
      subject: g.subject,
      description: g.desc,
      owner: g.owner,
      participants: parts.map((p) => ({ id: p.jid, role: this.roleOf(p) })),
      size: g.size ?? parts.length,
      creation: g.creation,
      announce: g.announce,
      restrict: g.restrict,
    };
  }

  private toGroup(g: WaGroupMetadata): GroupInfo {
    const participants = (g.participants ?? []) as ReadonlyArray<{
      jid: string;
      isAdmin: boolean;
      isSuperAdmin: boolean;
    }>;
    return {
      jid: g.jid,
      subject: g.subject,
      description: g.desc,
      owner: g.owner,
      participants: participants.map((p) => ({
        id: p.jid,
        role: p.isSuperAdmin ? 'superadmin' : p.isAdmin ? 'admin' : 'member',
      })),
      size: g.size ?? participants.length,
      creation: g.creation,
      announce: g.announce,
      restrict: g.restrict,
    };
  }

  private toNewsletter(n: Record<string, unknown>): NewsletterInfo {
    const thread = (n.thread_metadata ?? n.threadMetadata) as Record<string, unknown> | undefined;
    const viewer = (n.viewer_metadata ?? n.viewerMetadata) as Record<string, unknown> | undefined;
    const nameRaw = n.name ?? thread?.name;
    const name =
      typeof nameRaw === 'string' ? nameRaw : ((nameRaw as { text?: string })?.text ?? '');
    const descRaw = n.description ?? thread?.description;
    const description =
      typeof descRaw === 'string' ? descRaw : (descRaw as { text?: string })?.text;
    const subsRaw = n.subscribers ?? n.subscriberCount ?? thread?.subscribers_count;
    const subscriberCount =
      typeof subsRaw === 'string' ? parseInt(subsRaw, 10) : (subsRaw as number | undefined);
    const roleRaw = ((n.role as string) ?? (viewer?.role as string))?.toLowerCase();
    const muteRaw = (n.mute_state as string) ?? (viewer?.mute as string);
    const verificationRaw = (n.verification as string) ?? (thread?.verification as string);
    return {
      jid: String(n.jid ?? n.id ?? ''),
      name,
      description: description || undefined,
      subscriberCount,
      role: roleRaw as NewsletterInfo['role'],
      muted: muteRaw ? muteRaw.toUpperCase() === 'ON' : undefined,
      inviteCode: (n.invite as string) || (thread?.invite as string) || undefined,
      verified: verificationRaw ? verificationRaw.toUpperCase() === 'VERIFIED' : undefined,
    };
  }

  private normalize(event: WaIncomingMessageEvent): NormalizedMessage | null {
    const content = event.message;
    const chatId = event.key?.remoteJid;
    if (!content || !chatId) return null;

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
      id: event.key.id ?? '',
      chatId,
      from: event.key.participant ?? chatId,
      fromMe: event.key.fromMe ?? false,
      pushName: event.pushName,
      isGroup: event.key.isGroup,
      chatType: classifyJid(chatId),
      timestamp: event.timestampSeconds ?? Math.floor(Date.now() / 1000),
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
      raw: event,
    };
  }
}
