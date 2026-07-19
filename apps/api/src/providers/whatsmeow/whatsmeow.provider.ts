import axios, { AxiosInstance } from 'axios';
import * as QRCode from 'qrcode';
import { BaseProvider, ProviderContext } from '../provider.interface';
import { mapWithConcurrency } from '../concurrency.util';
import { buildVCard } from '../vcard.util';
import {
  ConnectionStatus,
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
  NewsletterInfo,
  CreateNewsletterInput,
  Label,
  LabelTarget,
  MessageAckStatus,
  MessageType,
  NormalizedMessage,
  PortableCredentials,
  ProviderType,
  SendMediaInput,
  SendPollInput,
  SendLocationInput,
  SendContactInput,
  SendStatusInput,
  ReactMessageInput,
  EditMessageInput,
  DeleteMessageInput,
  SendResult,
  SendTextInput,
  UpsertLabelInput,
  WebhookEvent,
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

  /**
   * whatsmeow entrega grupos, etiquetas e comunidades via sidecar Go; o resto
   * é 501 uniforme. Comunidades têm CRUD nativo no sidecar
   * (`internal/whatsapp/client.go`), mas com algumas lacunas pontuais em
   * relação ao contrato canônico — os métodos afetados lançam erro explícito
   * em vez de fingir suporte (ver comentários em cada um e
   * `docs/community-contract-handoff.md`).
   */
  readonly capabilities = {
    groups: true,
    labels: true,
    communities: true,
    profile: true,
    contactAvatar: true,
    newsletter: true,
    // Cablado no sidecar: SendMedia agora usa UploadNewsletter + SendRequestExtra.MediaHandle
    // pra destinos @newsletter (sem criptografia, mesmo mecanismo documentado
    // na própria lib go.mau.fi/whatsmeow). Ver docs/newsletter-contract-handoff.md.
    newsletterMedia: true,
    reactions: true,
    editMessage: true,
    deleteMessage: true,
    location: true,
    contact: true,
    status: true,
    poll: true,
    pollResults: false,
    // `POST /message/poll` funciona pra DM/grupo normal (confirmado ao vivo),
    // mas o servidor do WhatsApp REJEITA poll pra jid @newsletter — testado
    // ao vivo (rodada 3) contra um canal real de teste: erro reproduzível
    // "server returned error 479" nas 2 tentativas. `BuildPollCreation` +
    // `SendMessage` genérico não tratam @newsletter como caso especial (ao
    // contrário de SendMedia, que já tem o branch `isNewsletter` com
    // `MediaHandle`) — gap real da lib go.mau.fi/whatsmeow, não do sidecar.
    // Ver docs/newsletter-contract-handoff.md.
    newsletterPoll: false,
  };

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
      webhook_events: ['MESSAGE', 'CONNECTION_STATUS', 'MESSAGE_STATUS', 'GROUP_MEMBERS_EDIT'],
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
    const jid = this.toJid(input.to);
    const res = await this.client().post('/message/text', {
      to: jid,
      text: input.text,
      reply_to: input.quotedMessageId,
    });
    return this.result(res.data, jid);
  }

  async sendMedia(input: SendMediaInput): Promise<SendResult> {
    if (input.type === 'sticker') {
      throw new Error('whatsmeow (serviço Go): sticker não suportado por /message/media');
    }
    if (!input.url) {
      throw new Error('whatsmeow (serviço Go): envio de mídia exige "url" (base64 não suportado)');
    }
    const jid = this.toJid(input.to);
    const res = await this.client().post('/message/media', {
      to: jid,
      type: input.type,
      url: input.url,
      caption: input.caption,
      file_name: input.filename,
      mime_type: input.mimetype,
      reply_to: input.quotedMessageId,
    });
    return this.result(res.data, jid);
  }

  /** `POST /message/poll` já existe no sidecar (`BuildPollCreation` da lib — sem upload, sem TOS, qualquer destino incl. `@newsletter`). */
  async sendPoll(input: SendPollInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const res = await this.client().post('/message/poll', {
      to: jid,
      question: input.question,
      options: input.options,
      max_selections: input.selectableCount ?? 1,
    });
    return this.result(res.data, jid);
  }

  async reactMessage(input: ReactMessageInput): Promise<SendResult> {
    const jid = this.toJid(input.chatId);
    const res = await this.client().post('/message/react', {
      to: jid,
      message_id: input.messageId,
      emoji: input.emoji,
      from_me: input.fromMe ?? false,
      sender: input.participant ? this.toJid(input.participant) : undefined,
    });
    return this.result(res.data, jid);
  }

  async editMessage(input: EditMessageInput): Promise<SendResult> {
    const jid = this.toJid(input.chatId);
    const res = await this.client().post('/message/edit', {
      to: jid,
      message_id: input.messageId,
      text: input.text,
    });
    return this.result(res.data, jid);
  }

  async sendLocation(input: SendLocationInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const res = await this.client().post('/message/location', {
      to: jid,
      latitude: input.latitude,
      longitude: input.longitude,
      name: input.name,
      address: input.address,
      reply_to: input.quotedMessageId,
    });
    return this.result(res.data, jid);
  }

  async sendContact(input: SendContactInput): Promise<SendResult> {
    const jid = this.toJid(input.to);
    const res = await this.client().post('/message/contact', {
      to: jid,
      contacts: input.contacts.map((c) => ({ display_name: c.fullName, vcard: buildVCard(c) })),
      reply_to: input.quotedMessageId,
    });
    return this.result(res.data, jid);
  }

  /** `POST /message/status` do sidecar; o statusJidList não é aplicado no whatsmeow (audiência padrão). */
  async sendStatus(input: SendStatusInput): Promise<SendResult> {
    const res = await this.client().post('/message/status', {
      type: input.type,
      text: input.text,
      caption: input.caption,
      url: input.url,
      mime_type: input.mimetype,
      background_color: input.backgroundColor,
      font: input.font,
      status_jid_list: input.statusJidList,
    });
    return this.result(res.data, 'status@broadcast');
  }

  /** O sidecar Go só faz revoke (para todos); `forEveryone:false` cai no mesmo caminho. */
  async deleteMessage(input: DeleteMessageInput): Promise<SendResult> {
    const jid = this.toJid(input.chatId);
    await this.client().delete('/message', {
      data: {
        to: jid,
        message_ids: [input.messageId],
        for_everyone: input.forEveryone !== false,
      },
    });
    return {
      id: input.messageId,
      to: jid,
      timestamp: Math.floor(Date.now() / 1000),
      status: 'sent',
    };
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
      case 'GROUP_MEMBERS_EDIT': {
        // Grupos e subgrupos de comunidade compartilham o mesmo evento no sidecar —
        // repassa como o webhook canônico "groups.participants.update" (mesmo que
        // o Baileys já emite via socket).
        const edit = evt.data as GoGroupMembersEditData | undefined;
        if (edit) this.emitWebhook(WebhookEvent.GROUP_PARTICIPANTS_UPDATE, edit);
        break;
      }
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
      const all = res.data as GroupInfo[];
      await this.attachPictureUrls(all);
      return all;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async groupMetadata(jid: string): Promise<GroupInfo> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(`/group/${encodeURIComponent(jid)}`);
      const info = res.data as GroupInfo;
      info.pictureUrl = await this.fetchPictureUrl(info.jid);
      return info;
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

  // ── comunidades (via sidecar Go) ──────────────────────
  // O sidecar já tem CRUD nativo de comunidade (`internal/whatsapp/client.go` +
  // rotas `/community` em `cmd/server/main.go`) — este adapter é um
  // pass-through fino, igual grupos/etiquetas. Lacunas pontuais do sidecar
  // (sem endpoint de 1 comunidade só, sem revoke de convite, sem link/unlink
  // avulso, foto só por URL) ficam documentadas método a método abaixo e em
  // `docs/community-contract-handoff.md`.

  /**
   * O sidecar já suporta `only_admin` nativamente em `GET /community`
   * (calcula admin/owner com o mapeamento PN↔LID dele mesmo — mais confiável
   * que reimplementar aqui) — só repassamos o parâmetro.
   */
  /** Busca crua, sem `pictureUrl` — usada tanto por `listCommunities` (que anexa
   * foto em lote) quanto por `communityMetadata` (que só precisa de 1 foto,
   * não das N da listagem inteira). */
  private async fetchCommunitiesRaw(onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]> {
    await this.ensureProvisioned();
    const res = await this.client().get('/community', {
      params: { include_members: true, only_admin: onlyOwnedOrAdmin || undefined },
    });
    const list = (res.data?.communities ?? []) as GoCommunityListItem[];
    return list.map((c) => this.toCommunity(c));
  }

  async listCommunities(onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]> {
    try {
      const all = await this.fetchCommunitiesRaw(onlyOwnedOrAdmin);
      await this.attachPictureUrls(all);
      return all;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  /**
   * O sidecar não tem `GET /community/:jid` — só listagem em lote (cacheada).
   * Emulamos via `fetchCommunitiesRaw` (sem filtro, sem foto em lote) + filtro
   * local, e resolvemos o subgrupo de anúncios/"Geral" + a própria foto com
   * uma chamada extra cada (paralelas).
   */
  async communityMetadata(jid: string): Promise<CommunityInfo> {
    try {
      const all = await this.fetchCommunitiesRaw();
      const found = all.find((c) => c.jid === jid);
      if (!found) throw new Error(`comunidade ${jid} não encontrada (ver GET /community)`);
      const [linked, pictureUrl] = await Promise.all([
        this.listCommunityLinkedGroups(jid).catch(() => [] as CommunityLinkedGroup[]),
        this.fetchPictureUrl(jid),
      ]);
      found.announcementGroupJid = linked.find((g) => g.isAnnounce)?.jid;
      found.defaultGroupJid = linked.find((g) => !g.isAnnounce)?.jid;
      found.pictureUrl = pictureUrl;
      return found;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async createCommunity(input: CreateCommunityInput): Promise<CommunityInfo> {
    try {
      await this.ensureProvisioned();
      // CommunityRequest do sidecar não tem participants/picture/removeDefaultGroup —
      // só `group_names` (subgrupos vazios criados junto). Pedimos 1 subgrupo
      // "Geral" quando há participantes iniciais, e povoamos/removemos depois
      // reaproveitando os métodos de grupo já existentes neste adapter.
      const wantsDefaultGroup = Boolean(input.participants?.length);
      const res = await this.client().post('/community', {
        name: input.subject,
        description: input.description ?? '',
        group_names: wantsDefaultGroup ? ['Geral'] : [],
      });
      const created = res.data as GoCreateCommunityResponse;
      const jid = created.community_jid;
      const defaultGroupJid = created.group_jids?.[0];

      if (input.picture) {
        try {
          await this.updateCommunityImage(jid, this.pictureToImageInput(input.picture));
        } catch (err) {
          this.logger.warn(
            `whatsmeow: falha ao definir imagem da comunidade ${jid}: ${(err as Error).message}`,
          );
        }
      }

      const removeDefault = input.removeDefaultGroup || input.deleteDefaultGroupChat;
      if (defaultGroupJid && input.participants?.length) {
        try {
          await this.updateGroupParticipants(defaultGroupJid, input.participants, 'add');
        } catch (err) {
          this.logger.warn(
            `whatsmeow: falha ao adicionar participantes iniciais na comunidade ${jid}: ${(err as Error).message}`,
          );
        }
      }
      if (defaultGroupJid && removeDefault) {
        try {
          // Mesma limitação de protocolo do Baileys: só dá pra sair, não apagar.
          await this.leaveGroup(defaultGroupJid);
        } catch (err) {
          this.logger.warn(
            `whatsmeow: falha ao sair do grupo padrão da comunidade ${jid}: ${(err as Error).message}`,
          );
        }
      }

      const info = await this.communityMetadata(jid);
      this.emitParticipantsSynced(info);
      if (info.announcementGroupJid)
        this.emitAnnouncementDiscovered(jid, info.announcementGroupJid);
      return info;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  /**
   * `DELETE /community/:jid` chama `DeleteCommunityFull` no sidecar, que
   * desvincula+sai de cada subgrupo e sai da comunidade — mesma aproximação
   * do Baileys (WhatsApp não expõe "apagar para todos" nem para o whatsmeow).
   */
  async deleteCommunity(jid: string): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().delete(`/community/${encodeURIComponent(jid)}`);
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async updateCommunitySubject(jid: string, subject: string): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().put(`/community/${encodeURIComponent(jid)}`, { name: subject });
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async updateCommunityDescription(jid: string, description: string): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().put(`/community/${encodeURIComponent(jid)}`, { description });
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  /** O sidecar só aceita `photo_url` (baixa o JPEG por HTTP) — base64 não é suportado. */
  async updateCommunityImage(jid: string, image: UpdateCommunityImageInput): Promise<void> {
    if (!image.url) {
      throw new Error(
        'whatsmeow (sidecar Go): imagem de comunidade só aceita "url" pública — base64 não é suportado por este endpoint.',
      );
    }
    try {
      await this.ensureProvisioned();
      await this.client().put(`/community/${encodeURIComponent(jid)}`, { photo_url: image.url });
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  /**
   * O sidecar não retorna status por participante (uma falha aborta o lote
   * inteiro) — sintetiza 200 pra todos após sucesso, refletindo a semântica
   * real "tudo ou nada" da chamada.
   */
  async updateCommunityAdmins(
    jid: string,
    members: string[],
    action: CommunityAdminAction,
  ): Promise<GroupParticipantResult[]> {
    try {
      await this.ensureProvisioned();
      const jids = members.map((m) => this.toJid(m));
      await this.client().post(`/community/${encodeURIComponent(jid)}/admins/${action}`, {
        participants: jids,
      });
      return jids.map((j) => ({ jid: j, status: '200' }));
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async listCommunityMembers(jid: string): Promise<CommunityParticipant[]> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(`/community/${encodeURIComponent(jid)}/members`);
      const members = (res.data?.members ?? []) as GoMember[];
      return members.map((m) => this.toParticipant(m));
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async countCommunityMembers(jid: string): Promise<number> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(`/community/${encodeURIComponent(jid)}/members`);
      return (res.data?.total as number) ?? 0;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  /**
   * O sidecar não expõe um convite único "da comunidade" — `GetInviteLink`
   * retorna um link por SUBGRUPO. Aproximamos escolhendo o link do subgrupo
   * de anúncios (ou o primeiro disponível) — ver limitação documentada.
   */
  async getCommunityInviteCode(jid: string): Promise<string> {
    const links = await this.fetchInviteLinks(jid);
    const preferred = await this.pickAnnouncementLink(jid, links);
    return preferred?.link ? this.codeFromLink(preferred.link) : '';
  }

  /**
   * Sem equivalente no sidecar: `GetInviteLink` não aceita `reset` para
   * comunidades (só para grupos avulsos, via outro método). Lança em vez de
   * fingir sucesso.
   */
  async revokeCommunityInviteCode(_jid: string): Promise<string> {
    throw new Error(
      'whatsmeow (sidecar Go): revogar/rotacionar convite de comunidade ainda não é suportado — GetInviteLink não expõe "reset" para comunidades.',
    );
  }

  async probeCommunityInvite(jid: string): Promise<CommunityInviteProbeResult> {
    try {
      const links = await this.fetchInviteLinks(jid);
      return { reachable: links.length > 0 };
    } catch {
      return { reachable: false };
    }
  }

  async listCommunityLinkedGroups(jid: string): Promise<CommunityLinkedGroup[]> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get('/community', { params: { include_members: false } });
      const list = (res.data?.communities ?? []) as GoCommunityListItem[];
      const found = list.find((c) => c.jid === jid);
      const subJids = found?.sub_groups ?? [];
      return Promise.all(
        subJids.map(async (sgJid) => {
          const g = await this.groupMetadata(sgJid).catch(() => null);
          return {
            jid: sgJid,
            subject: g?.subject ?? '',
            isAnnounce: g?.announce ?? false,
            size: g?.size,
          };
        }),
      );
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  /**
   * Sem equivalente no sidecar: não há rota para vincular um grupo JÁ
   * EXISTENTE a uma comunidade — só criar subgrupos novos junto na criação
   * (`participants`/`group_names` em `createCommunity`).
   */
  async linkGroupToCommunity(_groupJid: string, _communityJid: string): Promise<void> {
    throw new Error(
      'whatsmeow (sidecar Go): vincular um grupo existente a uma comunidade ainda não é suportado (sem rota /community/:jid/groups).',
    );
  }

  /**
   * Sem equivalente no sidecar: o desvínculo de subgrupo só acontece como
   * parte de `DELETE /community/:jid` (que também sai do subgrupo).
   */
  async unlinkGroupFromCommunity(_groupJid: string, _communityJid: string): Promise<void> {
    throw new Error(
      'whatsmeow (sidecar Go): desvincular um subgrupo isoladamente ainda não é suportado — só junto com a exclusão da comunidade.',
    );
  }

  /**
   * O sync do sidecar é POR INSTÂNCIA (não dá pra mirar 1 comunidade só) e é
   * assíncrono — dispara o resync e faz poucas tentativas até a comunidade
   * aparecer atualizada na listagem.
   */
  async syncCommunity(jid: string): Promise<CommunityInfo> {
    try {
      await this.ensureProvisioned();
      await this.client().post('/community/sync');
      const info = await this.pollForCommunity(jid);
      this.emitParticipantsSynced(info);
      if (info.announcementGroupJid)
        this.emitAnnouncementDiscovered(jid, info.announcementGroupJid);
      return info;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async syncAllCommunities(onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]> {
    try {
      await this.ensureProvisioned();
      await this.client().post('/community/sync');
      await new Promise((r) => setTimeout(r, 1500));
      const all = await this.listCommunities(onlyOwnedOrAdmin);
      for (const info of all) this.emitParticipantsSynced(info);
      return all;
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  private async fetchInviteLinks(jid: string): Promise<GoInviteLinkResult[]> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(`/community/${encodeURIComponent(jid)}/link`);
      return (res.data?.links ?? []) as GoInviteLinkResult[];
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  private async pickAnnouncementLink(
    jid: string,
    links: GoInviteLinkResult[],
  ): Promise<GoInviteLinkResult | undefined> {
    if (links.length <= 1) return links[0];
    const linked = await this.listCommunityLinkedGroups(jid).catch(
      () => [] as CommunityLinkedGroup[],
    );
    const announceJid = linked.find((g) => g.isAnnounce)?.jid;
    return links.find((l) => l.jid === announceJid) ?? links[0];
  }

  private codeFromLink(link: string): string {
    return link.replace(/^https?:\/\/chat\.whatsapp\.com\//, '');
  }

  private async pollForCommunity(jid: string, attempts = 3, delayMs = 700): Promise<CommunityInfo> {
    for (let i = 0; i < attempts; i += 1) {
      if (i > 0) await new Promise((r) => setTimeout(r, delayMs));
      try {
        return await this.communityMetadata(jid);
      } catch {
        continue;
      }
    }
    throw new Error(`comunidade ${jid} não apareceu no resync (tente novamente)`);
  }

  private pictureToImageInput(picture: string): UpdateCommunityImageInput {
    if (picture.startsWith('http://') || picture.startsWith('https://')) return { url: picture };
    return { base64: picture };
  }

  private toParticipant(m: GoMember): CommunityParticipant {
    return { id: m.jid, role: m.is_owner ? 'superadmin' : m.is_admin ? 'admin' : 'member' };
  }

  private toCommunity(c: GoCommunityListItem): CommunityInfo {
    return {
      jid: c.jid,
      subject: c.name,
      description: c.description || undefined,
      owner: c.owner_jid || undefined,
      participants: (c.members ?? []).map((m) => this.toParticipant(m)),
      size: c.member_count,
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

  // ── canais/newsletter (via sidecar Go) ────────────────
  // `GET/POST /newsletter[...]` já existe no sidecar (`internal/handler/newsletter_handler.go`
  // → `Client.{List,Create,...}Newsletter`), usando o `newsletter.go` nativo da
  // lib go.mau.fi/whatsmeow. Pass-through direto, mesmo padrão de grupos/etiquetas.

  async listNewsletters(): Promise<NewsletterInfo[]> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get('/newsletter');
      const list = (res.data?.newsletters ?? []) as GoNewsletterInfo[];
      return list.map((n) => this.toNewsletter(n));
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async newsletterMetadata(jid: string): Promise<NewsletterInfo> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(`/newsletter/${encodeURIComponent(jid)}`);
      return this.toNewsletter(res.data as GoNewsletterInfo);
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async createNewsletter(input: CreateNewsletterInput): Promise<NewsletterInfo> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().post('/newsletter', {
        name: input.name,
        description: input.description,
      });
      return this.toNewsletter(res.data as GoNewsletterInfo);
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async followNewsletter(jid: string): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().post(`/newsletter/${encodeURIComponent(jid)}/follow`);
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  async unfollowNewsletter(jid: string): Promise<void> {
    try {
      await this.ensureProvisioned();
      await this.client().delete(`/newsletter/${encodeURIComponent(jid)}/follow`);
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  private toNewsletter(n: GoNewsletterInfo): NewsletterInfo {
    return {
      jid: n.jid,
      name: n.name,
      description: n.description || undefined,
      subscriberCount: n.subscriber_count,
      role: (n.role || undefined) as NewsletterInfo['role'],
      muted: n.muted,
      inviteCode: n.invite_code || undefined,
      pictureUrl: n.picture_url || undefined,
    };
  }

  // ── perfil (via sidecar Go) ───────────────────────────
  // `GET /profile` já existe no sidecar (`internal/handler/profile_handler.go`
  // → `Client.GetProfile()`): pushName do store, status via `GetUserInfo`, foto
  // via `GetProfilePictureInfo`. Pass-through direto, sem lógica extra aqui.

  async getProfile(): Promise<ProfileInfo> {
    try {
      await this.ensureProvisioned();
      const res = await this.client().get('/profile');
      const d = res.data as {
        jid?: string;
        name?: string;
        status?: string;
        picture_url?: string;
      };
      return {
        jid: d.jid ?? '',
        name: d.name || undefined,
        status: d.status || undefined,
        profilePicUrl: d.picture_url || undefined,
      };
    } catch (e) {
      throw new Error(this.goError(e));
    }
  }

  /** Reusa o mesmo `fetchPictureUrl` privado (`GET /contact/:jid` no sidecar) já usado pra grupos/comunidades. */
  async getContactAvatar(jid: string): Promise<string | undefined> {
    return this.fetchPictureUrl(jid);
  }

  /**
   * `GET /contact/:jid` no sidecar chama `GetProfilePictureInfo` pra
   * QUALQUER jid — usuário, grupo ou comunidade (mesmo mecanismo de
   * `GET /profile`, só muda o jid) — reaproveitado aqui em vez de expor um
   * endpoint novo. Nota: como efeito colateral esse handler também faz
   * upsert de um "contact" no chat-store do sidecar pro jid consultado
   * (mesmo sendo um grupo/comunidade) — inofensivo pro gateway, mas vale
   * saber se aparecer um "contato" estranho no painel do sidecar.
   */
  private async fetchPictureUrl(jid: string): Promise<string | undefined> {
    if (!jid) return undefined;
    try {
      await this.ensureProvisioned();
      const res = await this.client().get(`/contact/${encodeURIComponent(jid)}`);
      const url = (res.data as { picture_url?: string })?.picture_url;
      return url || undefined;
    } catch {
      return undefined;
    }
  }

  /** Concorrência limitada — ver `BaileysProvider.attachPictureUrls` pro motivo. */
  private async attachPictureUrls(
    items: Array<{ jid: string; pictureUrl?: string }>,
  ): Promise<void> {
    const urls = await mapWithConcurrency(items, 6, (item) => this.fetchPictureUrl(item.jid));
    items.forEach((item, i) => {
      item.pictureUrl = urls[i];
    });
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
interface GoGroupMembersEditData {
  group_jid: string;
  action: string;
  participants: string[];
  actor?: string;
}
interface GoMember {
  jid: string;
  is_admin: boolean;
  is_owner?: boolean;
}
interface GoCommunityListItem {
  jid: string;
  name: string;
  description?: string;
  owner_jid: string;
  is_admin: boolean;
  is_owner: boolean;
  member_count: number;
  sub_groups?: string[];
  members?: GoMember[];
}
interface GoCreateCommunityResponse {
  community_jid: string;
  group_jids?: string[];
}
interface GoInviteLinkResult {
  jid: string;
  name: string;
  link: string;
}
interface GoNewsletterInfo {
  jid: string;
  name: string;
  description?: string;
  subscriber_count: number;
  role?: string;
  muted: boolean;
  invite_code?: string;
  picture_url?: string;
}
