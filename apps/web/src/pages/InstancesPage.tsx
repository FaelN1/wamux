import { useMemo, useState, type ComponentType } from 'react';
import {
  ArrowLeftRight,
  Clock,
  Plus,
  Power,
  QrCode,
  Search,
  Send,
  Settings,
  Trash2,
  X,
} from 'lucide-react';
import { ProviderType } from '@wamux/shared';
import { Instance, PROVIDERS, useDeleteInstance, useInstances, useLogout } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { CreateInstanceModal } from '@/components/CreateInstanceModal';
import { ChangeProviderModal } from '@/components/ChangeProviderModal';
import { QrModal } from '@/components/QrModal';
import { SendTestModal } from '@/components/SendTestModal';
import { InstanceSettingsSheet } from '@/components/InstanceSettingsSheet';

type Modal =
  | { type: 'create' }
  | { type: 'qr'; instance: Instance }
  | { type: 'send'; instance: Instance }
  | { type: 'settings'; instance: Instance }
  | { type: 'provider'; instance: Instance }
  | null;

const STATUS: Record<string, { badge: string; dot: string }> = {
  connected: { badge: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20', dot: 'bg-emerald-500' },
  connecting: { badge: 'bg-amber-500/10 text-amber-500 border-amber-500/20', dot: 'bg-amber-500' },
  qr: { badge: 'bg-sky-500/10 text-sky-500 border-sky-500/20', dot: 'bg-sky-500' },
  disconnected: { badge: 'bg-red-500/10 text-red-500 border-red-500/20', dot: 'bg-red-500' },
  logged_out: { badge: 'bg-red-500/10 text-red-500 border-red-500/20', dot: 'bg-red-500' },
  error: { badge: 'bg-red-500/10 text-red-500 border-red-500/20', dot: 'bg-red-500' },
};

// ── opções dos filtros ─────────────────────────────────────
const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos os status' },
  { value: 'connected', label: 'Conectado' },
  { value: 'connecting', label: 'Conectando' },
  { value: 'qr', label: 'Aguardando QR' },
  { value: 'disconnected', label: 'Desconectado' },
  { value: 'logged_out', label: 'Deslogado' },
  { value: 'error', label: 'Erro' },
];

const ENGINE_OPTIONS = [
  { value: 'all', label: 'Todas as engines' },
  ...PROVIDERS.map((p) => ({ value: p.value as string, label: p.label })),
];

const CREATED_OPTIONS = [
  { value: 'all', label: 'Qualquer data' },
  { value: '24h', label: 'Últimas 24h' },
  { value: '7d', label: 'Últimos 7 dias' },
  { value: '30d', label: 'Últimos 30 dias' },
];

const SORT_OPTIONS = [
  { value: 'recent', label: 'Mais recentes' },
  { value: 'oldest', label: 'Mais antigas' },
  { value: 'activity', label: 'Última atividade' },
  { value: 'name', label: 'Nome (A–Z)' },
];

const CREATED_MS: Record<string, number> = { '24h': 864e5, '7d': 7 * 864e5, '30d': 30 * 864e5 };

/** Timestamp relativo curto em pt-BR (ex.: "há 3 h"). */
function timeAgo(iso: string): string {
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `há ${d} d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `há ${mo} ${mo === 1 ? 'mês' : 'meses'}`;
  const y = Math.floor(mo / 12);
  return `há ${y} ${y === 1 ? 'ano' : 'anos'}`;
}

function StatusPill({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.disconnected;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
        s.badge,
      )}
    >
      <span className={cn('mr-1.5 size-1.5 rounded-full', s.dot)} />
      {status}
    </span>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={cn('h-9 w-auto gap-1.5', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ActionBtn({
  icon: Icon,
  title,
  onClick,
  danger,
  warn,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  onClick: () => void;
  danger?: boolean;
  warn?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        'rounded-md p-1.5 text-muted-foreground transition-colors',
        danger && 'hover:bg-red-500/10 hover:text-red-500',
        warn && 'hover:bg-amber-500/10 hover:text-amber-500',
        !danger && !warn && 'hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function InstancesPage() {
  const { data: instances, isLoading, error } = useInstances();
  const del = useDeleteInstance();
  const logout = useLogout();
  const [modal, setModal] = useState<Modal>(null);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [engine, setEngine] = useState('all');
  const [created, setCreated] = useState('all');
  const [sort, setSort] = useState('recent');

  const total = instances?.length ?? 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const cutoff = created === 'all' ? 0 : Date.now() - CREATED_MS[created];
    const list = (instances ?? []).filter((i) => {
      if (q && !i.name.toLowerCase().includes(q)) return false;
      if (status !== 'all' && (i.liveStatus ?? i.status) !== status) return false;
      if (engine !== 'all' && (i.provider as string) !== engine) return false;
      if (cutoff && new Date(i.createdAt).getTime() < cutoff) return false;
      return true;
    });
    const at = (i: Instance) => (i.lastActivityAt ? new Date(i.lastActivityAt).getTime() : -Infinity);
    const sorted = [...list];
    if (sort === 'recent') sorted.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    else if (sort === 'oldest') sorted.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    else if (sort === 'activity') sorted.sort((a, b) => at(b) - at(a));
    else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [instances, search, status, engine, created, sort]);

  const labelOf = (opts: { value: string; label: string }[], v: string) =>
    opts.find((o) => o.value === v)?.label ?? v;
  const chips: { label: string; onClear: () => void }[] = [];
  if (status !== 'all') chips.push({ label: labelOf(STATUS_OPTIONS, status), onClear: () => setStatus('all') });
  if (engine !== 'all') chips.push({ label: labelOf(ENGINE_OPTIONS, engine), onClear: () => setEngine('all') });
  if (created !== 'all') chips.push({ label: labelOf(CREATED_OPTIONS, created), onClear: () => setCreated('all') });

  const hasActive = chips.length > 0 || search.trim() !== '' || sort !== 'recent';
  const clearAll = () => {
    setSearch('');
    setStatus('all');
    setEngine('all');
    setCreated('all');
    setSort('recent');
  };

  return (
    <div className="space-y-6">
      {/* Toolbar — busca + filtros + ordenação numa única linha */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-56 md:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar instância..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <FilterSelect value={status} onChange={setStatus} options={STATUS_OPTIONS} />
          <FilterSelect value={engine} onChange={setEngine} options={ENGINE_OPTIONS} />
          <FilterSelect value={created} onChange={setCreated} options={CREATED_OPTIONS} />
          <FilterSelect value={sort} onChange={setSort} options={SORT_OPTIONS} className="sm:ml-auto" />
          <Button className="w-full sm:w-auto" onClick={() => setModal({ type: 'create' })}>
            <Plus /> Nova instância
          </Button>
        </div>

        {/* Chips de filtros ativos + contagem (só quando há filtro) */}
        {hasActive && (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {chips.map((c) => (
              <button
                key={c.label}
                onClick={c.onClear}
                className="inline-flex items-center gap-1 rounded-full border bg-secondary px-2.5 py-1 font-medium text-secondary-foreground transition-colors hover:bg-secondary/70"
              >
                {c.label}
                <X className="size-3" />
              </button>
            ))}
            <button
              onClick={clearAll}
              className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              Limpar tudo
            </button>
            <span className="ml-auto text-muted-foreground">
              {filtered.length} de {total} {total === 1 ? 'instância' : 'instâncias'}
            </span>
          </div>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-red-500">
          {(error as Error).message} — verifique a API key / se o gateway está no ar.
        </div>
      )}

      {isLoading ? (
        <p className="py-16 text-center text-sm text-muted-foreground">Carregando…</p>
      ) : total === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nenhuma instância. Crie a primeira em “Nova instância”.
        </p>
      ) : filtered.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted-foreground">
          Nenhuma instância corresponde aos filtros.{' '}
          <button onClick={clearAll} className="text-primary underline-offset-4 hover:underline">
            Limpar filtros
          </button>
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((inst) => {
            const st = inst.liveStatus ?? inst.status;
            const number = inst.wid?.split(':')[0]?.split('@')[0];
            return (
              <div
                key={inst.id}
                className="flex flex-col overflow-hidden rounded-xl border bg-card transition-colors hover:border-muted-foreground/30"
              >
                <div className="flex-1 p-5">
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="truncate font-semibold text-foreground" title={inst.name}>
                        {inst.name}
                      </h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {number ? `+${number}` : 'sem número'}
                      </p>
                    </div>
                    <span className="inline-flex items-center rounded border bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">
                      {PROVIDERS.find((p) => p.value === inst.provider)?.label ?? inst.provider}
                    </span>
                  </div>
                  <StatusPill status={st} />
                  <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="size-3.5 shrink-0" />
                    {inst.lastActivityAt ? `última msg ${timeAgo(inst.lastActivityAt)}` : 'sem mensagens ainda'}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t bg-muted/40 px-4 py-2.5">
                  <div className="flex items-center gap-0.5">
                    {inst.provider !== ProviderType.CLOUD_API && (
                      <ActionBtn
                        icon={QrCode}
                        title="Conectar / QR"
                        onClick={() => setModal({ type: 'qr', instance: inst })}
                      />
                    )}
                    <ActionBtn
                      icon={Send}
                      title="Enviar teste"
                      onClick={() => setModal({ type: 'send', instance: inst })}
                    />
                    <ActionBtn
                      icon={Settings}
                      title="Configurações (webhook, integrações)"
                      onClick={() => setModal({ type: 'settings', instance: inst })}
                    />
                    <ActionBtn
                      icon={ArrowLeftRight}
                      title="Trocar engine"
                      onClick={() => setModal({ type: 'provider', instance: inst })}
                    />
                  </div>
                  <div className="flex items-center gap-0.5">
                    <ActionBtn
                      icon={Power}
                      title="Desconectar"
                      warn
                      onClick={() => logout.mutate(inst.id)}
                    />
                    <ActionBtn
                      icon={Trash2}
                      title="Excluir instância"
                      danger
                      onClick={() => {
                        if (confirm(`Deletar a instância "${inst.name}"?`)) del.mutate(inst.id);
                      }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal?.type === 'create' && <CreateInstanceModal onClose={() => setModal(null)} />}
      {modal?.type === 'qr' && <QrModal instance={modal.instance} onClose={() => setModal(null)} />}
      {modal?.type === 'send' && <SendTestModal instance={modal.instance} onClose={() => setModal(null)} />}
      {modal?.type === 'settings' && (
        <InstanceSettingsSheet instance={modal.instance} onClose={() => setModal(null)} />
      )}
      {modal?.type === 'provider' && (
        <ChangeProviderModal instance={modal.instance} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
