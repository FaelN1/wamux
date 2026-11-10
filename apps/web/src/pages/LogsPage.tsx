import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, RefreshCw, Search, Wifi, WifiOff } from 'lucide-react';
import {
  PROVIDERS,
  type ActivityLogEntry,
  type ActivityLogStatus,
  type ActivityLogType,
} from '@wamux/shared';
import {
  downloadActivityLogExport,
  useActivityLogFacets,
  useActivityLogHistogram,
  useActivityLogs,
  useInstances,
  type ActivityLogFilters,
} from '@/api';
import { useActivityLogSocket } from '@/hooks/useActivityLogSocket';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

const RANGE_OPTIONS = [
  { value: '1h', label: 'Última hora', ms: 60 * 60 * 1000 },
  { value: '24h', label: 'Últimas 24 horas', ms: 24 * 60 * 60 * 1000 },
  { value: '7d', label: 'Últimos 7 dias', ms: 7 * 24 * 60 * 60 * 1000 },
  { value: '30d', label: 'Últimos 30 dias', ms: 30 * 24 * 60 * 60 * 1000 },
  { value: 'all', label: 'Tudo', ms: 0 },
] as const;

const STATUS_LABEL: Record<ActivityLogStatus, string> = {
  success: 'Sucesso',
  failed: 'Falha',
  pending: 'Pendente',
  skipped: 'Ignorado',
};

const STATUS_TONE: Record<ActivityLogStatus, string> = {
  success: 'text-emerald-500 bg-emerald-500/10',
  failed: 'text-red-500 bg-red-500/10',
  pending: 'text-amber-500 bg-amber-500/10',
  skipped: 'text-muted-foreground bg-muted',
};

const TYPE_LABEL: Record<ActivityLogType, string> = {
  messaging: 'Mensageria',
  connection: 'Conexão',
  groups: 'Grupos',
  communities: 'Comunidades',
  newsletter: 'Newsletter',
  api_request: 'API',
};

const ALL_STATUSES = Object.keys(STATUS_LABEL) as ActivityLogStatus[];
const ALL_TYPES = Object.keys(TYPE_LABEL) as ActivityLogType[];

function toggleIn<T>(set: T[], value: T): T[] {
  return set.includes(value) ? set.filter((v) => v !== value) : [...set, value];
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'warn' | 'good';
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          className={cn(
            'text-3xl font-bold',
            tone === 'warn' && 'text-amber-500',
            tone === 'good' && 'text-emerald-500',
          )}
        >
          {value}
        </div>
      </CardContent>
    </Card>
  );
}

function Histogram({
  buckets,
}: {
  buckets: { bucketStart: number; count: number; errorCount: number }[];
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  if (!buckets.length) {
    return <p className="text-sm text-muted-foreground">Sem eventos no período.</p>;
  }
  return (
    <div className="flex h-24 items-end gap-0.5">
      {buckets.map((b) => (
        <div
          key={b.bucketStart}
          className="group relative flex-1 rounded-t bg-primary/70 hover:bg-primary"
          style={{ height: `${Math.max(4, (b.count / max) * 100)}%` }}
          title={`${new Date(b.bucketStart).toLocaleString('pt-BR')} · ${b.count} evento(s)${b.errorCount ? ` · ${b.errorCount} erro(s)` : ''}`}
        >
          {b.errorCount > 0 && (
            <div
              className="absolute inset-x-0 bottom-0 rounded-t bg-red-500"
              style={{ height: `${(b.errorCount / b.count) * 100}%` }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function FacetButton({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        active ? 'bg-primary/15 font-medium text-primary' : 'hover:bg-muted',
      )}
    >
      <span>{label}</span>
      <span className="text-xs text-muted-foreground">{count ?? 0}</span>
    </button>
  );
}

export function LogsPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [live, setLive] = useState(false);
  const [range, setRange] = useState<(typeof RANGE_OPTIONS)[number]['value']>('24h');
  const [status, setStatus] = useState<ActivityLogStatus[]>([]);
  const [type, setType] = useState<ActivityLogType[]>([]);
  const [statusCode, setStatusCode] = useState('');
  const [route, setRoute] = useState('');
  const [instanceId, setInstanceId] = useState('');
  const [platform, setPlatform] = useState('');
  const [selected, setSelected] = useState<ActivityLogEntry | null>(null);
  const [pages, setPages] = useState(1);

  const { data: instances } = useInstances();

  const from = useMemo(() => {
    const opt = RANGE_OPTIONS.find((r) => r.value === range);
    return opt && opt.ms > 0 ? Date.now() - opt.ms : undefined;
  }, [range]);

  const filters: ActivityLogFilters = useMemo(
    () => ({
      from,
      status: status.length ? status : undefined,
      type: type.length ? type : undefined,
      statusCode: statusCode ? Number(statusCode) : undefined,
      route: route || undefined,
      instanceId: instanceId || undefined,
      platform: platform || undefined,
      q: q || undefined,
    }),
    [from, status, type, statusCode, route, instanceId, platform, q],
  );

  const list = useActivityLogs(filters, undefined, pages * 50);
  const facets = useActivityLogFacets(filters);
  const histogram = useActivityLogHistogram(
    filters,
    range === '1h' || range === '24h' ? 'hour' : 'day',
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['activity-logs'] });
    void qc.invalidateQueries({ queryKey: ['activity-logs-facets'] });
    void qc.invalidateQueries({ queryKey: ['activity-logs-histogram'] });
  };

  const { connected } = useActivityLogSocket(live, () => refresh());

  const items = list.data?.items ?? [];
  const totalEvents = Object.values(facets.data?.status ?? {}).reduce((a, b) => a + (b ?? 0), 0);
  const failedEvents = facets.data?.status?.failed ?? 0;
  const errorRate = totalEvents ? failedEvents / totalEvents : 0;

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar em activity/mensagem…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="pl-8"
          />
        </div>
        <label
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium',
            live && connected
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
              : 'border-muted bg-muted/50 text-muted-foreground',
          )}
        >
          {live && connected ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
          {live && connected ? 'Live' : 'Sem tempo real'}
          <Switch checked={live} onCheckedChange={setLive} className="ml-1 scale-75" />
        </label>
        <Button variant="outline" size="sm" onClick={refresh}>
          <RefreshCw className="size-4" /> Atualizar
        </Button>
        <Button variant="outline" size="sm" onClick={() => void downloadActivityLogExport(filters)}>
          <Download className="size-4" /> Download
        </Button>
      </div>

      {/* Summary + histogram */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Eventos no período" value={totalEvents.toLocaleString('pt-BR')} />
        <StatCard
          label="% erro"
          value={`${Math.round(errorRate * 100)}%`}
          tone={errorRate > 0.1 ? 'warn' : errorRate === 0 ? 'good' : undefined}
        />
        <Card className="sm:col-span-2 lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Eventos ao longo do tempo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Histogram buckets={histogram.data ?? []} />
          </CardContent>
        </Card>
      </div>

      {/* Filters + table */}
      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <Select value={range} onValueChange={(v) => setRange(v as typeof range)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RANGE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {ALL_STATUSES.map((s) => (
                <FacetButton
                  key={s}
                  active={status.includes(s)}
                  label={STATUS_LABEL[s]}
                  count={facets.data?.status?.[s]}
                  onClick={() => setStatus((cur) => toggleIn(cur, s))}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-0.5">
              {ALL_TYPES.map((t) => (
                <FacetButton
                  key={t}
                  active={type.includes(t)}
                  label={TYPE_LABEL[t]}
                  count={facets.data?.type?.[t]}
                  onClick={() => setType((cur) => toggleIn(cur, t))}
                />
              ))}
            </CardContent>
          </Card>

          <details className="rounded-lg border">
            <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium">
              Mais filtros
            </summary>
            <div className="space-y-3 border-t p-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Status code</label>
                <Input
                  value={statusCode}
                  onChange={(e) => setStatusCode(e.target.value)}
                  placeholder="ex.: 500"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Route</label>
                <Input
                  value={route}
                  onChange={(e) => setRoute(e.target.value)}
                  placeholder="ex.: /groups"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Account</label>
                <Select
                  value={instanceId || '__all__'}
                  onValueChange={(v) => setInstanceId(v === '__all__' ? '' : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    {(instances ?? []).map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Platform</label>
                <Select
                  value={platform || '__all__'}
                  onValueChange={(v) => setPlatform(v === '__all__' ? '' : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">Todas</SelectItem>
                    {PROVIDERS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </details>
        </aside>

        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Time</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-left font-medium">Activity</th>
                  <th className="px-4 py-2 text-left font-medium">Platform</th>
                  <th className="px-4 py-2 text-left font-medium">Duration</th>
                  <th className="px-4 py-2 text-left font-medium">Message</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr
                    key={it.id}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/40"
                    onClick={() => setSelected(it)}
                  >
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {new Date(it.createdAt).toLocaleString('pt-BR')}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          'rounded-full px-2 py-0.5 text-xs font-medium',
                          STATUS_TONE[it.status],
                        )}
                      >
                        {STATUS_LABEL[it.status]}
                      </span>
                    </td>
                    <td className="max-w-xs truncate px-4 py-2 font-medium" title={it.activity}>
                      {it.activity}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">{it.platform ?? '—'}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {it.durationMs != null ? `${it.durationMs}ms` : '—'}
                    </td>
                    <td
                      className="max-w-sm truncate px-4 py-2 text-muted-foreground"
                      title={it.message}
                    >
                      {it.message ?? '—'}
                    </td>
                  </tr>
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                      {list.isLoading ? 'Carregando…' : 'Nenhum evento com esses filtros.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {list.data?.nextCursor && (
              <div className="border-t p-3 text-center">
                <Button variant="outline" size="sm" onClick={() => setPages((p) => p + 1)}>
                  Carregar mais
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>{selected?.activity}</SheetTitle>
            <SheetDescription>
              {selected && new Date(selected.createdAt).toLocaleString('pt-BR')}
            </SheetDescription>
          </SheetHeader>
          {selected && (
            <div className="space-y-3 px-4 pb-4 text-sm">
              <Row label="Status" value={STATUS_LABEL[selected.status]} />
              <Row label="Type" value={TYPE_LABEL[selected.type]} />
              <Row label="Method" value={selected.method} />
              <Row label="Route" value={selected.route} />
              <Row label="Status code" value={selected.statusCode?.toString()} />
              <Row
                label="Duration"
                value={selected.durationMs != null ? `${selected.durationMs}ms` : undefined}
              />
              <Row label="Platform" value={selected.platform} />
              <Row label="Account" value={selected.instanceId} />
              <Row label="API key" value={selected.apiKeyLabel} />
              <Row label="Message" value={selected.message} />
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-4 border-b pb-2">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="break-all text-right font-medium">{value}</span>
    </div>
  );
}
