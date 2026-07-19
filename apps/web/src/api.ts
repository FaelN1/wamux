import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  type WamuxSettings,
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
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
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

// ── API keys com escopo granular + apps MCP ──────────────────────────────
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
