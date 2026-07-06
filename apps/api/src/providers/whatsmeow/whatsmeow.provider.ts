import axios, { AxiosInstance } from 'axios';
import * as QRCode from 'qrcode';
import { BaseProvider, ProviderContext } from '../provider.interface';
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
  PortableCredentials,
  ProviderType,
  SendMediaInput,
  SendResult,
  SendTextInput,
  UpsertLabelInput,
} from '../provider.types';

/**
 * Adapter whatsmeow via SIDECAR Go (a API `wamux_go`, em
 * `services/whatsmeow/`). O whatsmeow é uma lib Go — não roda no processo Node.
 *
 * O serviço Go é ele próprio uma API multi-instância completa. Aqui o adapter
 * age como um pass-through fino:
 *  - PROVISIONA: na primeira inicialização, cria a instância correspondente no
 *    serviço Go (master key), guarda o `api_key` retornado e aponta o webhook
 *    do serviço Go de volta para `…/webhooks/whatsmeow/:id` do gateway.
 *  - ENVIA por REST (`X-API-Key` da instância).
 *  - RECEBE via webhook do serviço Go → `handleInboundWebhook` normaliza.
 *
 * Config esperada na instância (tudo opcional):
 *   { "companyName": "...", "sideName": "...", "phoneNumber": "...", "proxyUrl": "..." }
 * Config global (injetada pela factory): whatsmeowUrl, whatsmeowMasterKey,
 * whatsmeowCallbackBaseUrl.
 */
export class WhatsmeowProvider extends BaseProvider {
  readonly type = ProviderType.WHATSMEOW;

  private baseUrl!: string;
  private masterKey!: string;
  private http?: AxiosInstance; // cliente escopado à instância (X-API-Key)
  private goApiKey?: string;
  private goInstanceId?: string;

  constructor(ctx: ProviderContext) {
    super(ctx);
  }

  readonly portableCredentials = true;

  /** whatsmeow entrega grupos e etiquetas via sidecar Go; o resto é 501 uniforme. */
  readonly capabilities = { groups: true, labels: true };

  async initialize(): Promise<void> {
    await this.ensureProvisioned();
    // Sincroniza status pela rota master /instance/all (ver nota em provision).
    await this.syncStatusViaMaster();
  }

  /**
   * Garante baseUrl/masterKey, provisionamento no serviço Go e o cliente http
   * (X-API-Key da instância). Idempotente — não conecta a sessão.
   */
  private async ensureProvisioned(): Promise<void> {
    if (this.http) return;
    this.baseUrl = `${this.str('whatsmeowUrl')}/api/v1`;
    this.masterKey = this.str('whatsmeowMasterKey');
    if (!this.masterKey) throw new Error('whatsmeow: WHATSMEOW_MASTER_KEY não configurada');

    this.goApiKey = (await this.sessionStore.get(this.instanceId, 'go_api_key')) ?? undefined;
    this.goInstanceId =
      (await this.sessionStore.get(this.instanceId, 'go_instance_id')) ?? undefined;

    if (!this.goApiKey) {
      await this.provision();
    }
    this.http = axios.create({
      baseURL: this.baseUrl,
      headers: { 'X-API-Key': this.goApiKey! },
      timeout: 20_000,
    });
  }

  // ── migração de credenciais (Multi-Device) via serviço Go ──

  async exportCredentials(): Promise<PortableCredentials> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get('/instance/export');
      return res.data as PortableCredentials;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async importCredentials(creds: PortableCredentials): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().post('/instance/import', creds);
      // Sobe o socket da sessão recém-importada — o device já está linkado, então
      // conecta direto (sem QR, sem logout). O webhook CONNECTION_STATUS do
      // serviço Go depois promove o status para "connected".
      await axios.post(
        `${this.baseUrl}/instance/${this.goInstanceId}/resume`,
        {},
        { headers: { 'X-API-Key': this.masterKey }, timeout: 20_000 },
      );
      this.setStatus(ConnectionStatus.CONNECTING);
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  /** Extrai a mensagem de erro do corpo da resposta do serviço Go. */
  private goError(e: unknown): string {
    const ax = e as {
      response?: { status?: number; data?: unknown };
      message?: string;
    };
    const data = ax.response?.data;
    const msg =
      data && typeof data === 'object' && 'message' in data
        ? (data as { message?: string }).message
        : undefined;
    if (msg) return msg;
    // Sem .message no corpo (ex.: 500 de panic com corpo vazio/texto). Expõe o
    // status + corpo cru pra diagnóstico em vez de mascarar como erro do axios.
    if (ax.response) {
      const body = typeof data === 'string' ? data : JSON.stringify(data);
      return `whatsmeow HTTP ${ax.response.status}: ${body || '(corpo vazio)'}`;
    }
    return ax.message ?? 'erro no serviço whatsmeow';
  }

  private async syncStatusViaMaster(): Promise<void> {
    try {
      const res = await axios.get(`${this.baseUrl}/instance/all`, {
        headers: { 'X-API-Key': this.masterKey },
        timeout: 20_000,
      });
      const list: Array<{ id: string; status: string }> = res.data?.instances ?? [];
      const found = list.find((i) => i.id === this.goInstanceId);
      this.setStatus(this.mapStatus(found?.status));
    } catch {
      this.setStatus(ConnectionStatus.CONNECTING);
    }
  }

  /** Cria a instância no serviço Go e persiste as credenciais retornadas. */
  private async provision(): Promise<void> {
    const callbackBase = this.str('whatsmeowCallbackBaseUrl') || 'http://localhost:3000';
    const webhookUrl = `${callbackBase}/api/webhooks/whatsmeow/${this.instanceId}`;

    const master = axios.create({
      baseURL: this.baseUrl,
      headers: { 'X-API-Key': this.masterKey },
      timeout: 20_000,
    });

    const companyName = this.str('companyName') || this.instanceId;
    const sideName = this.str('sideName') || 'gateway';

    // Auto-cura: se ficou uma instância órfã no serviço Go com o mesmo
    // (company_name, side_name) — ex.: a sessão aqui foi limpa num repareamento
    // mas o device persistiu lá —, remove antes de criar. A constraint UNIQUE
    // (company_name, side_name) barraria o create com um 500 de chave duplicada.
    await this.removeOrphan(master, companyName, sideName);

    const res = await master.post('/instance/', {
      company_name: companyName,
      side_name: sideName,
      webhook_url: webhookUrl,
      webhook_events: ['MESSAGE', 'CONNECTION_STATUS', 'MESSAGE_STATUS'],
      proxy_url: this.str('proxyUrl'),
      phone_number: this.str('phoneNumber'),
    });

    this.goInstanceId = res.data?.id;
    this.goApiKey = res.data?.api_key;
    if (!this.goApiKey || !this.goInstanceId) {
      throw new Error('whatsmeow: serviço Go não retornou api_key/id ao provisionar');
    }
    await this.sessionStore.set(this.instanceId, 'go_api_key', this.goApiKey);
    await this.sessionStore.set(this.instanceId, 'go_instance_id', this.goInstanceId);
    this.logger.log(`whatsmeow provisionado no serviço Go: ${this.goInstanceId}`);
  }

  /**
   * Remove uma instância órfã no serviço Go com o mesmo (company_name,
   * side_name), se existir. Órfã = criada num provisionamento anterior cujo
   * api_key o gateway perdeu (sessão limpa). Sem isso, o create falha na
   * constraint UNIQUE. É best-effort — falha na limpeza não aborta o fluxo.
   */
  private async removeOrphan(
    master: ReturnType<typeof axios.create>,
    companyName: string,
    sideName: string,
  ): Promise<void> {
    try {
      const res = await master.get('/instance/all');
      const list: Array<{ id: string; company_name?: string; side_name?: string }> =
        res.data?.instances ?? [];
      const orphan = list.find(
        (i) => i.company_name === companyName && (i.side_name ?? 'gateway') === sideName,
      );
      if (orphan) {
        await master.delete(`/instance/${orphan.id}`);
        this.logger.warn(
          `whatsmeow: instância órfã ${orphan.id} (company ${companyName}) removida antes de reprovisionar`,
        );
      }
    } catch (e) {
      this.logger.warn(
        `whatsmeow: limpeza de órfã falhou (segue mesmo assim): ${(e as Error).message}`,
      );
    }
  }

  async getQRCode(): Promise<{ qr: string; qrImage: string } | null> {
    if (this.status === ConnectionStatus.CONNECTED) return null;
    // Usa a rota master `/instance/:id/connect` (stream SSE de QR codes) porque
    // `/instance/qrcode` (chave de instância) fica sombreado pelo MasterKeyAuth
    // no app Go. Pega o primeiro QR do stream e converte para PNG.
    const raw = await this.streamFirstQr();
    if (!raw) return null;
    const qrImage = await QRCode.toDataURL(raw);
    this.setStatus(ConnectionStatus.QR, { qr: raw, qrImage });
    return { qr: raw, qrImage };
  }

  /** Consome o SSE de `/instance/:id/connect` (master) e resolve no 1º QR. */
  private async streamFirstQr(): Promise<string | null> {
    const resp = await axios.get(`${this.baseUrl}/instance/${this.goInstanceId}/connect`, {
      headers: { 'X-API-Key': this.masterKey },
      responseType: 'stream',
      timeout: 0,
    });
    const stream = resp.data as NodeJS.ReadableStream;

    return new Promise<string | null>((resolve) => {
      let buffer = '';
      let done = false;
      const finish = (value: string | null) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 30_000);

      stream.on('data', (chunk: Buffer) => {
        buffer += chunk.toString('utf8');
        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const event = /event:\s*(.*)/.exec(block)?.[1]?.trim();
          const data = /data:\s*([\s\S]*)/.exec(block)?.[1]?.trim();
          if (event === 'qr' && data) return finish(data);
          if (event === 'success' || event === 'timeout') return finish(null);
        }
      });
      stream.on('end', () => finish(null));
      stream.on('error', () => finish(null));
    });
  }

  async sendText(input: SendTextInput): Promise<SendResult> {
    const res = await this.client().post('/message/text', {
      to: this.toJid(input.to),
      text: input.text,
      reply_to: input.quotedMessageId,
    });
    return this.result(res.data, input.to);
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    if (input.type === 'sticker') {
      throw new Error('whatsmeow (serviço Go): sticker não suportado por /message/media');
    }
    if (!input.url) {
      throw new Error('whatsmeow (serviço Go): envio de mídia exige "url" (base64 não suportado)');
    }
    const res = await this.client().post('/message/media', {
      to: this.toJid(input.to),
      type: input.type,
      url: input.url,
      caption: input.caption,
      file_name: input.filename,
      mime_type: input.mimetype,
      reply_to: input.quotedMessageId,
    });
    return this.result(res.data, input.to);
  }

  async logout(): Promise<void> {
    // Desconecta o device no serviço Go (rota master). Mantém o provisionamento
    // para permitir reparear depois.
    if (this.goInstanceId) {
      try {
        await axios.post(
          `${this.baseUrl}/instance/${this.goInstanceId}/disconnect`,
          {},
          { headers: { 'X-API-Key': this.masterKey }, timeout: 20_000 },
        );
      } catch {
        /* pode já estar desconectado */
      }
    }
    this.setStatus(ConnectionStatus.LOGGED_OUT);
  }

  async destroy(): Promise<void> {
    // Shutdown do gateway não derruba o serviço Go (ele segue conectado).
    this.http = undefined;
    this.setStatus(ConnectionStatus.DISCONNECTED);
  }

  /** Webhook de entrada vindo do serviço Go: { event, instance_id, timestamp, data }. */
  async handleInboundWebhook(payload: unknown): Promise<void> {
    const evt = payload as GoWebhook;
    switch (evt?.event) {
      case 'MESSAGE':
        if (evt.data) this.emitTyped('message', this.normalize(evt.data as GoMessageData));
        break;
      case 'CONNECTION_STATUS':
        this.setStatus(this.mapStatus((evt.data as { status?: string })?.status));
        break;
      case 'MESSAGE_STATUS':
        this.emitStatuses(evt.data as GoStatusData);
        break;
      default:
        break;
    }
  }

  // ── helpers ───────────────────────────────────────────────

  private str(key: string): string {
    const v = this.config[key];
    return typeof v === 'string' ? v : '';
  }

  // ── grupos (via sidecar Go) ──────────────────────────

  async listGroups(): Promise<GroupInfo[]> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get('/group');
      return res.data as GroupInfo[];
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async groupMetadata(jid: string): Promise<GroupInfo> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(`/group/${encodeURIComponent(jid)}`);
      return res.data as GroupInfo;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async createGroup(input: CreateGroupInput): Promise<GroupInfo> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().post('/group', {
        subject: input.subject,
        participants: input.participants.map((p) => this.toJid(p)),
        description: input.description,
      });
      return res.data as GroupInfo;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async updateGroupParticipants(
    jid: string,
    participants: string[],
    action: GroupParticipantAction,
  ): Promise<GroupParticipantResult[]> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().post(`/group/${encodeURIComponent(jid)}/participants`, {
        participants: participants.map((p) => this.toJid(p)),
        action,
      });
      return res.data as GroupParticipantResult[];
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async updateGroupSubject(jid: string, subject: string): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().put(`/group/${encodeURIComponent(jid)}/subject`, { subject });
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async updateGroupDescription(jid: string, description: string): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().put(`/group/${encodeURIComponent(jid)}/description`, { description });
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async updateGroupSetting(jid: string, setting: GroupSetting): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().put(`/group/${encodeURIComponent(jid)}/setting`, { setting });
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async getGroupInviteCode(jid: string): Promise<string> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(`/group/${encodeURIComponent(jid)}/invite`);
      return (res.data as { code?: string }).code ?? '';
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async revokeGroupInviteCode(jid: string): Promise<string> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().delete(`/group/${encodeURIComponent(jid)}/invite`);
      return (res.data as { code?: string }).code ?? '';
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async joinGroupViaInvite(code: string): Promise<{ jid: string }> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().post('/group/join', { code });
      return { jid: (res.data as { jid?: string }).jid ?? '' };
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async leaveGroup(jid: string): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().post(`/group/${encodeURIComponent(jid)}/leave`, {});
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  // ── etiquetas (via sidecar Go) ───────────────────────

  private toLabel(l: { id: string; name: string; color: number }): Label {
    return { id: l.id, name: l.name, color: { index: l.color }, active: true };
  }

  async listLabels(): Promise<Label[]> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get('/label');
      return (res.data as Array<{ id: string; name: string; color: number }>).map((l) =>
        this.toLabel(l),
      );
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async upsertLabel(input: UpsertLabelInput): Promise<Label> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().post('/label', {
        id: input.id,
        name: input.name,
        color: input.color?.index ?? 0,
      });
      return this.toLabel(res.data as { id: string; name: string; color: number });
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async deleteLabel(labelId: string): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().delete(`/label/${encodeURIComponent(labelId)}`);
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async setLabelForTarget(labelId: string, target: LabelTarget, on: boolean): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().put(`/label/${encodeURIComponent(labelId)}/chat`, {
        chat_jid: this.toJid(target.id),
        on,
      });
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async getLabelsForTarget(target: LabelTarget): Promise<Label[]> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(
        `/chat-labels/${encodeURIComponent(this.toJid(target.id))}`,
      );
      return (res.data as Array<{ id: string; name: string; color: number }>).map((l) =>
        this.toLabel(l),
      );
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async getChatsForLabel(labelId: string): Promise<string[]> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(`/label/${encodeURIComponent(labelId)}/chats`);
      return (res.data as { chats?: string[] }).chats ?? [];
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  private client(): AxiosInstance {
    if (!this.http) throw new Error('whatsmeow: adapter não inicializado (chame connect antes)');
    return this.http;
  }

  private toJid(to: string): string {
    if (to.includes('@')) return to;
    return `${to.replace(/\D/g, '')}@s.whatsapp.net`;
  }

  private mapStatus(status?: string): ConnectionStatus {
    switch (status) {
      case 'connected':
        return ConnectionStatus.CONNECTED;
      case 'connecting':
        return ConnectionStatus.CONNECTING;
      case 'pairing':
        return ConnectionStatus.PAIRING;
      case 'passkey_pending': // aguarda aprovação no celular
        return ConnectionStatus.PASSKEY_PENDING;
      case 'qr_expired':
        return ConnectionStatus.QR_EXPIRED;
      case 'logged_out':
        return ConnectionStatus.LOGGED_OUT;
      default:
        return ConnectionStatus.DISCONNECTED;
    }
  }

  private result(data: GoSendResponse, to: string): SendResult {
    return {
      id: data?.message_id ?? '',
      to,
      timestamp: Math.floor(Date.now() / 1000),
      status: 'sent',
    };
  }

  private emitStatuses(data: GoStatusData): void {
    if (!data?.message_ids) return;
    const ackMap: Record<string, MessageAckStatus> = {
      sent: MessageAckStatus.SERVER,
      delivered: MessageAckStatus.DELIVERED,
      read: MessageAckStatus.READ,
      played: MessageAckStatus.PLAYED,
    };
    for (const messageId of data.message_ids) {
      this.emitTyped('message.status', {
        provider: this.type,
        instanceId: this.instanceId,
        messageId,
        chatId: data.chat ?? '',
        status: ackMap[data.status] ?? MessageAckStatus.PENDING,
        timestamp: data.timestamp ?? Math.floor(Date.now() / 1000),
      });
    }
  }

  private normalize(data: GoMessageData): NormalizedMessage {
    const typeMap: Record<string, MessageType> = {
      text: MessageType.TEXT,
      image: MessageType.IMAGE,
      video: MessageType.VIDEO,
      audio: MessageType.AUDIO,
      document: MessageType.DOCUMENT,
      sticker: MessageType.STICKER,
    };
    return {
      provider: this.type,
      instanceId: this.instanceId,
      id: data.message_id,
      chatId: data.chat,
      from: data.from,
      fromMe: false,
      isGroup: Boolean(data.is_group),
      timestamp: data.timestamp ?? 0,
      type: typeMap[data.type] ?? MessageType.UNKNOWN,
      text: data.text || undefined,
      // media_base64 fica só no `raw` para não inflar o evento canônico.
      media: data.has_media
        ? { mimetype: data.mime_type, filename: data.file_name, caption: data.text }
        : undefined,
      raw: data,
    };
  }
}

// ── tipos parciais do contrato do serviço Go ─────────────────
interface GoSendResponse {
  message_id?: string;
  status?: string;
}
interface GoWebhook {
  event?: string;
  instance_id?: string;
  timestamp?: string;
  data?: unknown;
}
interface GoMessageData {
  message_id: string;
  from: string;
  chat: string;
  is_group?: boolean;
  timestamp?: number;
  type: string;
  text?: string;
  has_media?: boolean;
  mime_type?: string;
  file_name?: string;
  media_base64?: string;
}
interface GoStatusData {
  message_ids?: string[];
  from?: string;
  chat?: string;
  status: string;
  timestamp?: number;
}
