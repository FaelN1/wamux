import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PROVIDERS,
  WEBHOOK_EVENTS,
  EVENT_TRANSPORTS,
  ApiKeyAction,
  type ActivityLogEntry,
  type ActivityLogFacetCounts,
  type ActivityLogHistogramBucket,
  type ActivityLogStatus,
  type ActivityLogType,
  type ApiKeySummary,
  type CreateApiKeyInput,
  type CreateApiKeyResult,
  type ChatMessage,
  type ChatSummary,
  type ContactSummary,
  type InstanceDTO,
  type InstanceEventsConfig,
  type PaginatedResult,
  type ProviderType,
  type QrResponse,
  type SettingsUpdate,
  type StatsOverview,
  type SystemInfo,
  type WamuxSettings,
  type MessageTemplate,
  type CreateTemplateInput,
  type SendTemplateInput,
  type Flow,
  type FlowAsset,
  type FlowCategory,
  type FlowEncryptionInfo,
  type FlowSession,
  type FlowSessionStatus,
  type FlowStatus,
  type CreateFlowInput,
  type CreateFlowResult,
  type SendFlowInput,
  type SetFlowEncryptionInput,
  type UpdateFlowMetadataInput,
} from '@wamux/shared';

// API versionada: rotas de negócio em /api/v1; health/webhooks são
// version-neutral (/api/health, /api/webhooks/...) e não passam por aqui.
const BASE = '/api/v1';
const KEY_STORAGE = 'wamux_apikey';

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? '';
}
export function setApiKey(k: string): void {
  localStorage.setItem(KEY_STORAGE, k);
}
export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
}

// ── request cru para o Playground: captura tudo sem lançar ──
export interface RawResult {
  ok: boolean;
  status: number;
  statusText: string;
  ms: number;
  data: unknown;
  error?: string;
}

export async function rawRequest(
  method: string,
  path: string,
  body?: string,
  apiKeyOverride?: string,
): Promise<RawResult> {
  const started = performance.now();
  const upper = method.toUpperCase();
  const hasBody = !!body && body.trim() !== '' && upper !== 'GET' && upper !== 'HEAD';
  const headers: Record<string, string> = { apikey: apiKeyOverride?.trim() || getApiKey() };
  if (hasBody) headers['Content-Type'] = 'application/json';
  try {
    const res = await fetch(BASE + path, {
      method: upper,
      headers,
      body: hasBody ? body : undefined,
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      ms: Math.round(performance.now() - started),
      data,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      statusText: 'Network Error',
      ms: Math.round(performance.now() - started),
      data: null,
      error: (e as Error).message,
    };
  }
}

/**
 * Erro de uma chamada à API. Continua sendo um `Error` (a `message` é a mesma de
 * sempre), mas carrega o status HTTP e o `error.code` do upstream (ex.: código da
 * Graph API da Meta) para as telas que querem mostrá-los.
 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string | number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      apikey: getApiKey(),
      ...(options.headers ?? {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
    const code = data?.error?.code;
    throw new ApiError(
      typeof msg === 'string' ? msg : JSON.stringify(msg),
      res.status,
      typeof code === 'string' || typeof code === 'number' ? code : undefined,
    );
  }
  return data as T;
}

// ── tipos (fonte única: @wamux/shared) ───────────────────
export { PROVIDERS, WEBHOOK_EVENTS, EVENT_TRANSPORTS, ApiKeyAction };
export type { InstanceEventsConfig, ApiKeySummary, CreateApiKeyInput, CreateApiKeyResult };
/** União string dos valores de ProviderType — ergonômico para estado de form. */
export type Provider = `${ProviderType}`;
export type Instance = InstanceDTO;
export type Qr = QrResponse;

export interface CreateInstanceBody {
  name: string;
  provider: Provider;
  config?: Record<string, unknown>;
  webhookUrl?: string;
}

// ── hooks ────────────────────────────────────────────────
export function useInstances() {
  return useQuery({
    queryKey: ['instances'],
    queryFn: () => req<Instance[]>('/instances'),
    refetchInterval: 4000,
  });
}

export function useStats() {
  return useQuery({
    queryKey: ['stats'],
    queryFn: () => req<StatsOverview>('/stats/overview'),
    refetchInterval: 10_000,
  });
}

export function useCreateInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInstanceBody) =>
      req<Instance>('/instances', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });
}

export function useConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => req(`/instances/${id}/connect`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => req(`/instances/${id}/logout`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });
}

export function useDeleteInstance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => req(`/instances/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });
}

export function useSetWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, url, events }: { id: string; url: string; events?: string[] }) =>
      req(`/instances/${id}/webhook`, {
        method: 'PUT',
        body: JSON.stringify({ url, events }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });
}

/** Salva a config de eventos (webhook + websocket + rabbitmq) de uma vez. */
export function useSetEvents() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, config }: { id: string; config: InstanceEventsConfig }) =>
      req(`/instances/${id}/events`, { method: 'PUT', body: JSON.stringify(config) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });
}

// ── API keys com escopo granular ──────────────────────────────────────
export function useApiKeys(instanceId: string) {
  return useQuery({
    queryKey: ['api-keys', instanceId],
    queryFn: () => req<ApiKeySummary[]>(`/instances/${instanceId}/api-keys`),
  });
}

export function useCreateApiKey(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateApiKeyInput) =>
      req<CreateApiKeyResult>(`/instances/${instanceId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', instanceId] }),
  });
}

export function useRevokeApiKey(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) =>
      req(`/instances/${instanceId}/api-keys/${keyId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys', instanceId] }),
  });
}

export interface ChangeProviderResult {
  migrated: boolean;
  requiresQr: boolean;
  message: string;
}

export function useChangeProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, provider, migrate }: { id: string; provider: Provider; migrate: boolean }) =>
      req<ChangeProviderResult>(`/instances/${id}/provider`, {
        method: 'POST',
        body: JSON.stringify({ provider, migrate }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['instances'] }),
  });
}

export function useSendText() {
  return useMutation({
    mutationFn: ({ id, to, text }: { id: string; to: string; text: string }) =>
      req(`/messages/${id}/text`, { method: 'POST', body: JSON.stringify({ to, text }) }),
  });
}

export interface SendMediaBody {
  id: string;
  to: string;
  type: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  base64: string;
  filename?: string;
  mimetype?: string;
  caption?: string;
  /** áudio como nota de voz — a API converte para ogg/opus antes de enviar. */
  asPtt?: boolean;
}

/** Composer do Inbox reusa esse mesmo endpoint (`POST /messages/:id/media`) que já existia. */
export function useSendMedia() {
  return useMutation({
    mutationFn: ({ id, ...body }: SendMediaBody) =>
      req(`/messages/${id}/media`, { method: 'POST', body: JSON.stringify(body) }),
  });
}

// ── Inbox (leitura persistida — opt-in via DATABASE_SAVE_DATA_*) ─────────

export interface ChatsFilter {
  q?: string;
  type?: string;
  archived?: boolean;
}

/** Lista de conversas persistidas, "Newest first". Vazia se `persistence.contacts` off. */
export function useChats(instanceId: string | null, filter: ChatsFilter = {}) {
  const params = new URLSearchParams();
  if (filter.q) params.set('q', filter.q);
  if (filter.type) params.set('type', filter.type);
  if (filter.archived != null) params.set('archived', String(filter.archived));
  const qs = params.toString();
  return useQuery({
    queryKey: ['inbox-chats', instanceId, filter],
    enabled: !!instanceId,
    queryFn: () =>
      req<PaginatedResult<ChatSummary>>(`/instances/${instanceId}/chats${qs ? `?${qs}` : ''}`),
  });
}

/** Thread persistida de um chat. Rota separada da ao-vivo (`/messages`, sem `/db`). */
export function useChatMessages(instanceId: string | null, jid: string | null) {
  return useQuery({
    queryKey: ['inbox-messages', instanceId, jid],
    enabled: !!instanceId && !!jid,
    queryFn: () => {
      const encodedJid = encodeURIComponent(jid ?? '');
      return req<PaginatedResult<ChatMessage>>(
        `/instances/${instanceId}/chats/${encodedJid}/messages/db?limit=50`,
      );
    },
  });
}

export function useContacts(instanceId: string | null, q?: string) {
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';
  return useQuery({
    queryKey: ['inbox-contacts', instanceId, q],
    enabled: !!instanceId,
    queryFn: () => req<PaginatedResult<ContactSummary>>(`/instances/${instanceId}/contacts${qs}`),
  });
}

export function useMarkChatRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, jid }: { id: string; jid: string }) =>
      req(`/instances/${id}/chats/${encodeURIComponent(jid)}/read`, { method: 'POST' }),
    onSuccess: (_data, { id }) => qc.invalidateQueries({ queryKey: ['inbox-chats', id] }),
  });
}

// ── templates HSM (Cloud API) ────────────────────────────
export type { MessageTemplate };

export function useTemplates(instanceId: string | null) {
  return useQuery({
    queryKey: ['templates', instanceId],
    enabled: !!instanceId,
    retry: false,
    queryFn: () => req<MessageTemplate[]>(`/instances/${instanceId}/templates`),
  });
}

export function useCreateTemplate(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateTemplateInput) =>
      req(`/instances/${instanceId}/templates`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates', instanceId] }),
  });
}

export function useDeleteTemplate(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      req(`/instances/${instanceId}/templates?name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['templates', instanceId] }),
  });
}

export function useSendTemplate(instanceId: string) {
  return useMutation({
    mutationFn: (body: SendTemplateInput) =>
      req(`/instances/${instanceId}/templates/send`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  });
}

// ── WhatsApp Flows (Cloud API) ───────────────────────────
export type {
  Flow,
  FlowAsset,
  FlowCategory,
  FlowEncryptionInfo,
  FlowSession,
  FlowSessionStatus,
  FlowStatus,
  CreateFlowResult,
};

export interface FlowEndpointConfig {
  /** serviço do integrador (recebe o payload já decifrado). */
  url: string | null;
  /** URL do gateway a registrar como `endpoint_uri` do Flow; null sem PUBLIC_BASE_URL. */
  endpointUri: string | null;
}

export interface FlowValidationResult {
  validation_errors: unknown[];
}

export interface SendFlowResult {
  id?: string;
  to?: string;
  status?: string;
  flowToken?: string;
}

const flowsPath = (instanceId: string) => `/instances/${instanceId}/flows`;

/** `enabled` separado do id: a tela só consulta quando a instância é `cloud`. */
export function useFlows(instanceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['flows', instanceId],
    enabled: !!instanceId && enabled,
    retry: false,
    queryFn: () => req<Flow[]>(flowsPath(instanceId ?? '')),
  });
}

export function useFlow(instanceId: string, flowId: string | null) {
  return useQuery({
    queryKey: ['flow', instanceId, flowId],
    enabled: !!instanceId && !!flowId,
    retry: false,
    queryFn: () => req<Flow>(`${flowsPath(instanceId)}/${flowId}`),
  });
}

export function useFlowAssets(instanceId: string, flowId: string | null) {
  return useQuery({
    queryKey: ['flow-assets', instanceId, flowId],
    enabled: !!instanceId && !!flowId,
    retry: false,
    queryFn: () => req<FlowAsset[]>(`${flowsPath(instanceId)}/${flowId}/assets`),
  });
}

/**
 * Conteúdo do Flow JSON vigente, baixado PELO GATEWAY (`GET :flowId/json`) — a
 * `download_url` do asset é temporária e o CDN da Meta não garante CORS. Se a
 * query falhar, a tela cai no editor vazio + link de download.
 */
export function useFlowJsonDownload(instanceId: string, flowId: string | null) {
  return useQuery({
    queryKey: ['flow-json', instanceId, flowId],
    enabled: !!instanceId && !!flowId,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async () =>
      (await req<{ flowJson: string | null }>(`${flowsPath(instanceId)}/${flowId}/json`))
        .flowJson ?? '',
  });
}

export function useCreateFlow(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFlowInput) =>
      req<CreateFlowResult>(flowsPath(instanceId), { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flows', instanceId] }),
  });
}

export function useUpdateFlowMetadata(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flowId, patch }: { flowId: string; patch: UpdateFlowMetadataInput }) =>
      req(`${flowsPath(instanceId)}/${flowId}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: (_data, { flowId }) => {
      void qc.invalidateQueries({ queryKey: ['flows', instanceId] });
      void qc.invalidateQueries({ queryKey: ['flow', instanceId, flowId] });
    },
  });
}

export function useUpdateFlowJson(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ flowId, flowJson }: { flowId: string; flowJson: string }) =>
      req<FlowValidationResult>(`${flowsPath(instanceId)}/${flowId}/assets`, {
        method: 'POST',
        body: JSON.stringify({ flowJson }),
      }),
    // validation_errors, versões e preview mudam junto com o JSON. Os assets NÃO
    // são invalidados de propósito: recarregar o JSON por cima do editor aberto
    // trocaria o texto que o usuário acabou de salvar pelo que a Meta reformatou.
    onSuccess: (_data, { flowId }) => {
      void qc.invalidateQueries({ queryKey: ['flows', instanceId] });
      void qc.invalidateQueries({ queryKey: ['flow', instanceId, flowId] });
    },
  });
}

/** publish / deprecate / delete: mesma forma (`flowId` → ok) e mesma invalidação. */
function useFlowLifecycle(instanceId: string, run: (flowId: string) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: run,
    onSuccess: (_data, flowId) => {
      void qc.invalidateQueries({ queryKey: ['flows', instanceId] });
      void qc.invalidateQueries({ queryKey: ['flow', instanceId, flowId] });
    },
  });
}

export function usePublishFlow(instanceId: string) {
  return useFlowLifecycle(instanceId, (flowId) =>
    req(`${flowsPath(instanceId)}/${flowId}/publish`, { method: 'POST' }),
  );
}

export function useDeprecateFlow(instanceId: string) {
  return useFlowLifecycle(instanceId, (flowId) =>
    req(`${flowsPath(instanceId)}/${flowId}/deprecate`, { method: 'POST' }),
  );
}

export function useDeleteFlow(instanceId: string) {
  return useFlowLifecycle(instanceId, (flowId) =>
    req(`${flowsPath(instanceId)}/${flowId}`, { method: 'DELETE' }),
  );
}

export function useSendFlow(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SendFlowInput) =>
      req<SendFlowResult>(`${flowsPath(instanceId)}/send`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    // cada envio abre uma sessão — a aba Execuções precisa enxergá-la.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['flow-sessions', instanceId] }),
  });
}

export function useFlowEncryption(instanceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['flow-encryption', instanceId],
    enabled: !!instanceId && enabled,
    retry: false,
    queryFn: () => req<FlowEncryptionInfo>(`${flowsPath(instanceId ?? '')}/encryption`),
  });
}

export function useSetFlowEncryption(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SetFlowEncryptionInput) =>
      req<FlowEncryptionInfo>(`${flowsPath(instanceId)}/encryption`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => qc.setQueryData(['flow-encryption', instanceId], data),
  });
}

export function useFlowEndpoint(instanceId: string | null, enabled = true) {
  return useQuery({
    queryKey: ['flow-endpoint', instanceId],
    enabled: !!instanceId && enabled,
    retry: false,
    queryFn: () => req<FlowEndpointConfig>(`${flowsPath(instanceId ?? '')}/endpoint`),
  });
}

export function useSetFlowEndpoint(instanceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (url: string | null) =>
      req<FlowEndpointConfig>(`${flowsPath(instanceId)}/endpoint`, {
        method: 'PUT',
        body: JSON.stringify({ url }),
      }),
    onSuccess: (data) => qc.setQueryData(['flow-endpoint', instanceId], data),
  });
}

export const FLOW_SESSIONS_PAGE_SIZE = 25;

/** Execuções, mais novas primeiro; o cursor é o `createdAt` da última linha (`before`). */
export function useFlowSessions(
  instanceId: string | null,
  status: FlowSessionStatus | '',
  enabled = true,
) {
  return useInfiniteQuery({
    queryKey: ['flow-sessions', instanceId, status],
    enabled: !!instanceId && enabled,
    retry: false,
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const p = new URLSearchParams({ limit: String(FLOW_SESSIONS_PAGE_SIZE) });
      if (status) p.set('status', status);
      if (pageParam) p.set('before', pageParam);
      return req<FlowSession[]>(`${flowsPath(instanceId ?? '')}/sessions?${p.toString()}`);
    },
    getNextPageParam: (last) =>
      last.length === FLOW_SESSIONS_PAGE_SIZE ? last[last.length - 1].createdAt : undefined,
  });
}

export function useFlowSession(instanceId: string, flowToken: string | null) {
  return useQuery({
    queryKey: ['flow-session', instanceId, flowToken],
    enabled: !!instanceId && !!flowToken,
    retry: false,
    queryFn: () =>
      req<FlowSession>(`${flowsPath(instanceId)}/sessions/${encodeURIComponent(flowToken ?? '')}`),
  });
}

// upload de mídia (multipart) — devolve URL pública p/ usar em media.url ----
export interface UploadedMedia {
  url: string;
  type: 'image' | 'video' | 'audio' | 'document';
  mimetype: string;
  filename: string;
  size: number;
}

export function useUploadMedia() {
  return useMutation({
    mutationFn: async (file: File): Promise<UploadedMedia> => {
      const fd = new FormData();
      fd.append('file', file);
      // sem Content-Type de propósito: o browser injeta o boundary do multipart.
      const res = await fetch(BASE + '/media/upload', {
        method: 'POST',
        headers: { apikey: getApiKey() },
        body: fd,
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const msg = data?.error?.message ?? data?.message ?? `HTTP ${res.status}`;
        throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      }
      return data as UploadedMedia;
    },
  });
}

/** QR em polling — habilitado só enquanto o modal estiver aberto. */
export function useQr(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['qr', id],
    enabled: !!id && enabled,
    queryFn: () => req<Qr>(`/instances/${id}/qr`),
    refetchInterval: 3000,
  });
}

// ── settings globais ─────────────────────────────────────
export type Settings = WamuxSettings;

export function useSettings() {
  return useQuery({ queryKey: ['settings'], queryFn: () => req<WamuxSettings>('/settings') });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsUpdate) =>
      req<WamuxSettings>('/settings', { method: 'PUT', body: JSON.stringify(patch) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings'] }),
  });
}

/**
 * Diagnóstico somente-leitura. `refetchInterval` porque o estado dos serviços
 * muda por fora do painel (um container cai, o ffmpeg some da imagem) — sem
 * isso a tela mostraria um retrato do momento em que foi aberta.
 */
export function useSystemInfo() {
  return useQuery({
    queryKey: ['settings-system'],
    queryFn: () => req<SystemInfo>('/settings/system'),
    refetchInterval: 30_000,
  });
}

// ── painel de Logs/Atividade (escopo admin — GLOBAL_API_KEY) ─────────────
export interface ActivityLogFilters {
  from?: number;
  to?: number;
  status?: ActivityLogStatus[];
  type?: ActivityLogType[];
  statusCode?: number;
  route?: string;
  instanceId?: string;
  platform?: string;
  q?: string;
}

function activityLogQs(filters: ActivityLogFilters, extra?: Record<string, string>): string {
  const p = new URLSearchParams();
  if (filters.from != null) p.set('from', String(filters.from));
  if (filters.to != null) p.set('to', String(filters.to));
  if (filters.status?.length) p.set('status', filters.status.join(','));
  if (filters.type?.length) p.set('type', filters.type.join(','));
  if (filters.statusCode != null) p.set('statusCode', String(filters.statusCode));
  if (filters.route) p.set('route', filters.route);
  if (filters.instanceId) p.set('instanceId', filters.instanceId);
  if (filters.platform) p.set('platform', filters.platform);
  if (filters.q) p.set('q', filters.q);
  for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function useActivityLogs(filters: ActivityLogFilters, cursor?: string, limit = 50) {
  const qs = activityLogQs(filters, { limit: String(limit), ...(cursor ? { cursor } : {}) });
  return useQuery({
    queryKey: ['activity-logs', filters, cursor, limit],
    queryFn: () => req<PaginatedResult<ActivityLogEntry>>(`/activity-logs${qs}`),
  });
}

export function useActivityLogFacets(filters: ActivityLogFilters) {
  const qs = activityLogQs(filters);
  return useQuery({
    queryKey: ['activity-logs-facets', filters],
    queryFn: () => req<ActivityLogFacetCounts>(`/activity-logs/facets${qs}`),
  });
}

export function useActivityLogHistogram(
  filters: ActivityLogFilters,
  bucket: 'hour' | 'day' = 'hour',
) {
  const qs = activityLogQs(filters, { bucket });
  return useQuery({
    queryKey: ['activity-logs-histogram', filters, bucket],
    queryFn: () => req<ActivityLogHistogramBucket[]>(`/activity-logs/histogram${qs}`),
  });
}

/** Download direto — precisa do header `apikey` (não dá pra ser um link cru), então busca + blob. */
export async function downloadActivityLogExport(filters: ActivityLogFilters): Promise<void> {
  const qs = activityLogQs(filters);
  const res = await fetch(`${BASE}/activity-logs/export${qs}`, {
    headers: { apikey: getApiKey() },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'activity-logs.csv';
  a.click();
  URL.revokeObjectURL(url);
}
