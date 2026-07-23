import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCheck,
  ChevronDown,
  ChevronUp,
  Clock,
  Gauge,
  Image as ImageIcon,
  Info,
  Leaf,
  Lightbulb,
  MapPin,
  MessageCircle,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  SmilePlus,
  Sprout,
  Trash2,
  Video,
  X,
  Zap,
} from 'lucide-react';
import {
  useCreateMaturationPlan,
  useDeleteMaturationPlan,
  useInstances,
  useMaturationAction,
  useMaturationPlans,
  useUpdateMaturationPlan,
  type Instance,
  type MaturationPlanDTO,
} from '@/api';
import {
  MATURATION_PRESETS,
  maturationTargetForDay,
  maturationTotalPerInstance,
  type MaturationConfig,
  type MaturationEventKind,
  type MaturationInstanceProgress,
  type MaturationPlanStatus,
} from '@wamux/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// ── metadados de exibição ────────────────────────────────────────────

const PLAN_STATUS: Record<MaturationPlanStatus, { label: string; cls: string }> = {
  draft: { label: 'Rascunho', cls: 'bg-muted text-muted-foreground ring-border' },
  running: {
    label: 'Rodando',
    cls: 'bg-emerald-500/10 text-emerald-600 ring-emerald-500/30 dark:text-emerald-400',
  },
  paused: {
    label: 'Pausado',
    cls: 'bg-amber-500/10 text-amber-600 ring-amber-500/30 dark:text-amber-400',
  },
  completed: {
    label: 'Concluído',
    cls: 'bg-sky-500/10 text-sky-600 ring-sky-500/30 dark:text-sky-400',
  },
};

const INTENSITY_META = {
  gentle: {
    label: 'Suave',
    icon: Leaf,
    tagline: '21 dias · começa com 8 msgs/dia',
    blurb:
      'Rampa longa e cautelosa. Ideal para chips novos ou recém-banidos — prioriza a sobrevivência do número, não a velocidade.',
  },
  standard: {
    label: 'Padrão',
    icon: Gauge,
    tagline: '14 dias · começa com 12 msgs/dia',
    blurb:
      'Equilíbrio entre tempo e segurança. O ponto de partida recomendado para a maioria dos casos.',
  },
  accelerated: {
    label: 'Acelerado',
    icon: Zap,
    tagline: '7 dias · começa com 20 msgs/dia',
    blurb:
      'Rampa curta e intensa. Use só com chips que já têm algum histórico — pressa aumenta o risco de ban.',
  },
  custom: { label: 'Personalizado', icon: Pencil, tagline: '', blurb: '' },
} as const;

const EVENT_META: Record<MaturationEventKind, { icon: typeof Info; cls: string }> = {
  sent: { icon: MessageCircle, cls: 'text-primary' },
  read: { icon: CheckCheck, cls: 'text-sky-500' },
  reaction: { icon: SmilePlus, cls: 'text-pink-500' },
  skip: { icon: AlertTriangle, cls: 'text-amber-500' },
  info: { icon: Info, cls: 'text-muted-foreground' },
  error: { icon: AlertTriangle, cls: 'text-destructive' },
};

const connDot = (s: string) =>
  s === 'connected'
    ? 'bg-emerald-500'
    : s === 'connecting' || s === 'qr' || s === 'pairing'
      ? 'bg-amber-500'
      : 'bg-red-500';

/** Offset do navegador em horas inteiras (ex.: -3 em Brasília). */
const browserUtcOffset = () => Math.round(-new Date().getTimezoneOffset() / 60);

const fmtHour = (h: number) => `${String(h).padStart(2, '0')}h`;

// ── blocos visuais reutilizados ──────────────────────────────────────

function ProgressBar({
  value,
  max,
  className,
}: {
  value: number;
  max: number;
  className?: string;
}) {
  const pct = Math.min(100, (value / Math.max(max, 1)) * 100);
  return (
    <div className={cn('h-2 w-full overflow-hidden rounded-full bg-muted', className)}>
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-500"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

/**
 * Rampa de mensagens/dia (série única — passado/hoje/futuro variam só a
 * intensidade da mesma cor). Hover mostra a leitura do dia acima do gráfico.
 */
function RampChart({
  config,
  currentDay,
  className,
}: {
  config: MaturationConfig;
  currentDay?: number;
  className?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const days = useMemo(
    () => Array.from({ length: config.durationDays }, (_, d) => maturationTargetForDay(config, d)),
    [config],
  );
  const max = Math.max(...days);
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
        <span>
          {hover != null
            ? `Dia ${hover + 1} — ${days[hover]} msgs/número`
            : `Rampa: ${days[0]} → ${max} msgs/dia por número`}
        </span>
        {currentDay != null && currentDay < config.durationDays && (
          <span className="font-medium text-foreground">hoje: dia {currentDay + 1}</span>
        )}
      </div>
      <div className="flex h-24 items-end gap-[2px]" onMouseLeave={() => setHover(null)}>
        {days.map((v, d) => (
          <div
            key={d}
            className="flex h-full min-w-0 flex-1 items-end"
            onMouseEnter={() => setHover(d)}
          >
            <div
              className={cn(
                'w-full rounded-t-[3px] transition-colors',
                hover === d
                  ? 'bg-primary'
                  : d === currentDay
                    ? 'bg-primary'
                    : currentDay != null && d < currentDay
                      ? 'bg-primary/60'
                      : 'bg-primary/25',
              )}
              style={{ height: `${Math.max((v / max) * 100, 4)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground/70">
        <span>dia 1</span>
        <span>dia {config.durationDays}</span>
      </div>
    </div>
  );
}

/** Countdown até o próximo turno; acima de 1h vira horário absoluto. */
function Countdown({ target }: { target: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const ms = target - now;
  if (ms <= 0) return <span className="text-primary">enviando…</span>;
  if (ms > 3_600_000) {
    const at = new Date(target);
    return (
      <span>
        às {String(at.getHours()).padStart(2, '0')}:{String(at.getMinutes()).padStart(2, '0')}
      </span>
    );
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return (
    <span className="tabular-nums">
      {m > 0 ? `${m}m ` : ''}
      {s}s
    </span>
  );
}

// ── explicador (colapsável) ──────────────────────────────────────────

function Explainer() {
  const [open, setOpen] = useState(true);
  return (
    <Card>
      <button
        className="flex w-full items-center justify-between px-6 py-4 text-left"
        onClick={() => setOpen((o) => !o)}
      >
        <div className="flex items-center gap-2">
          <Sprout className="size-5 text-primary" />
          <span className="font-medium">O que é maturação (aquecimento de chip)?</span>
        </div>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <CardContent className="space-y-4 pt-0">
          <p className="text-sm text-muted-foreground">
            Números novos (ou recém-reativados) que disparam muitas mensagens de uma vez são banidos
            pelo anti-spam do WhatsApp. A maturação constrói{' '}
            <b className="text-foreground">reputação gradual</b>: os números selecionados conversam
            entre si com padrão humano — horários realistas, pausas com variação, “digitando…”,
            leitura e reações — subindo o volume dia a dia até o número aguentar a operação real.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                n: '1',
                t: 'Selecione os números',
                d: 'Pelo menos 2 instâncias conectadas (baileys, webjs ou whatsmeow). Cloud API é oficial e não precisa disso.',
              },
              {
                n: '2',
                t: 'Defina o ritmo',
                d: 'Escolha um preset (ou personalize a rampa, janela de horário, delays e conteúdo).',
              },
              {
                n: '3',
                t: 'Acompanhe a rampa',
                d: 'O motor conversa sozinho e você acompanha metas, feed ao vivo e saúde de cada número aqui.',
              },
            ].map((s) => (
              <div key={s.n} className="rounded-lg border bg-muted/30 p-3">
                <div className="mb-1 flex size-6 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                  {s.n}
                </div>
                <div className="text-sm font-medium">{s.t}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{s.d}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
            <Lightbulb className="mt-0.5 size-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-medium">Boas práticas — maturação reduz o risco, não elimina:</p>
              <ul className="list-inside list-disc space-y-0.5">
                <li>
                  Mantenha os números conectados durante toda a rampa (o motor espera se caírem).
                </li>
                <li>
                  Misture contatos reais durante o aquecimento: um anel fechado que só fala entre si
                  também é um padrão detectável.
                </li>
                <li>
                  Evite muitos números no mesmo IP/proxy — configure proxy por instância se
                  precisar.
                </li>
                <li>
                  Não use o número em disparo em massa antes do fim da rampa; depois dela, os
                  limites anti-ban da instância continuam valendo.
                </li>
              </ul>
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

// ── card de plano ────────────────────────────────────────────────────

function InstanceRow({ p }: { p: MaturationInstanceProgress }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className={cn('size-1.5 shrink-0 rounded-full', connDot(p.connectionStatus))} />
      <span className="w-28 shrink-0 truncate font-medium" title={p.name}>
        {p.name}
      </span>
      <ProgressBar value={p.sentToday} max={p.targetToday} className="h-1.5" />
      <span className="w-16 shrink-0 text-right tabular-nums text-muted-foreground">
        {p.sentToday}/{p.targetToday}
      </span>
    </div>
  );
}

function PlanCard({
  plan,
  onEdit,
}: {
  plan: MaturationPlanDTO;
  onEdit: (p: MaturationPlanDTO) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const action = useMaturationAction();
  const del = useDeleteMaturationPlan();
  const status = PLAN_STATUS[plan.status];
  const intensity = INTENSITY_META[plan.config.intensity];
  const cfg = plan.config;
  const dayLabel = Math.min(plan.dayIndex + 1, cfg.durationDays);
  const sentToday = plan.instances.reduce((a, i) => a + i.sentToday, 0);
  const targetTodayPool = plan.instances.reduce((a, i) => a + i.targetToday, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="text-base">{plan.name}</CardTitle>
          <span
            className={cn(
              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
              status.cls,
            )}
          >
            {status.label}
          </span>
          <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            <intensity.icon className="size-3" /> {intensity.label}
          </span>
          <div className="ml-auto flex items-center gap-1">
            {plan.status === 'running' ? (
              <Button
                size="sm"
                variant="outline"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: plan.id, action: 'pause' })}
              >
                <Pause className="size-3.5" /> Pausar
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: plan.id, action: 'start' })}
              >
                {plan.status === 'paused' ? (
                  <>
                    <Play className="size-3.5" /> Retomar
                  </>
                ) : plan.status === 'completed' ? (
                  <>
                    <RotateCcw className="size-3.5" /> Reiniciar
                  </>
                ) : (
                  <>
                    <Play className="size-3.5" /> Iniciar
                  </>
                )}
              </Button>
            )}
            {plan.status !== 'running' && (
              <Button size="sm" variant="ghost" onClick={() => onEdit(plan)} title="Editar plano">
                <Pencil className="size-3.5" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              title="Excluir plano"
              onClick={() => {
                if (confirm(`Excluir o plano "${plan.name}"?`)) del.mutate(plan.id);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        {action.isError && (
          <p className="text-xs text-destructive">{(action.error as Error).message}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* rampa geral */}
        <div>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-muted-foreground">
              {plan.status === 'draft' ? (
                <>Rampa de {cfg.durationDays} dias — ainda não iniciada</>
              ) : plan.status === 'completed' ? (
                <>Rampa de {cfg.durationDays} dias concluída 🎉</>
              ) : (
                <>
                  Dia <b className="text-foreground">{dayLabel}</b> de {cfg.durationDays} · hoje:{' '}
                  <b className="text-foreground tabular-nums">
                    {sentToday}/{targetTodayPool}
                  </b>{' '}
                  msgs no pool
                </>
              )}
            </span>
            <span className="tabular-nums text-muted-foreground">
              {plan.totalSent} enviadas no total
            </span>
          </div>
          <ProgressBar
            value={plan.status === 'completed' ? cfg.durationDays : plan.dayIndex}
            max={cfg.durationDays}
          />
        </div>

        {/* countdown do próximo turno */}
        {plan.status === 'running' && plan.nextTurnAt && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="size-3.5" />
            próxima conversa <Countdown target={plan.nextTurnAt} />
          </div>
        )}

        {/* números do pool */}
        <div className="space-y-1.5">
          {plan.instances.slice(0, expanded ? undefined : 3).map((p) => (
            <InstanceRow key={p.instanceId} p={p} />
          ))}
          {!expanded && plan.instances.length > 3 && (
            <p className="text-xs text-muted-foreground">+{plan.instances.length - 3} número(s)…</p>
          )}
        </div>

        <button
          className="flex w-full items-center justify-center gap-1 rounded-md py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          onClick={() => setExpanded((e) => !e)}
        >
          {expanded ? (
            <>
              <ChevronUp className="size-3.5" /> menos detalhes
            </>
          ) : (
            <>
              <ChevronDown className="size-3.5" /> rampa + feed ao vivo
            </>
          )}
        </button>

        {expanded && (
          <div className="grid gap-4 border-t pt-3 lg:grid-cols-2">
            <div className="space-y-3">
              <RampChart
                config={cfg}
                currentDay={
                  plan.status === 'draft'
                    ? undefined
                    : Math.min(plan.dayIndex, cfg.durationDays - 1)
                }
              />
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                  janela {fmtHour(cfg.activeHours.start)}–{fmtHour(cfg.activeHours.end)}
                  {cfg.utcOffsetHours != null &&
                    ` (UTC${cfg.utcOffsetHours >= 0 ? '+' : ''}${cfg.utcOffsetHours})`}
                </span>
                <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                  pausa {cfg.minDelaySec}–{cfg.maxDelaySec}s
                </span>
                {cfg.simulateTyping && (
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                    digitando…
                  </span>
                )}
                {cfg.markAsRead && (
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                    marca lido
                  </span>
                )}
                <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                  reações {Math.round(cfg.reactionChance * 100)}%
                </span>
                {(cfg.mediaChance ?? 0) > 0 && !!cfg.mediaTypes?.length && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                    <ImageIcon className="size-3" />
                    {cfg.mediaTypes.map((t) => (t === 'image' ? 'foto' : 'vídeo')).join('/')}{' '}
                    {Math.round(cfg.mediaChance * 100)}%
                  </span>
                )}
                {(cfg.pollChance ?? 0) > 0 && (
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                    📊 enquete {Math.round(cfg.pollChance * 100)}%
                  </span>
                )}
                {(cfg.locationChance ?? 0) > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                    <MapPin className="size-3" /> {Math.round(cfg.locationChance * 100)}%
                  </span>
                )}
                {!!cfg.phrases?.length && (
                  <span className="rounded-md bg-secondary px-2 py-0.5 text-secondary-foreground">
                    +{cfg.phrases.length} frases suas
                  </span>
                )}
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Feed ao vivo (atualiza a cada 5s)
              </p>
              <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {plan.events.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nada ainda — inicie o plano para ver as conversas acontecendo aqui.
                  </p>
                )}
                {plan.events.map((e, i) => {
                  const meta = EVENT_META[e.kind] ?? EVENT_META.info;
                  return (
                    <div key={`${e.ts}-${i}`} className="flex items-start gap-2 text-xs">
                      <meta.icon className={cn('mt-0.5 size-3.5 shrink-0', meta.cls)} />
                      <span className="shrink-0 tabular-nums text-muted-foreground/70">
                        {new Date(e.ts).toLocaleTimeString('pt-BR', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <span className="min-w-0 break-words text-muted-foreground">
                        {e.kind === 'sent' ? (
                          <>
                            <b className="text-foreground">{e.from}</b> →{' '}
                            <b className="text-foreground">{e.to}</b>: “{e.text}”
                          </>
                        ) : (
                          <>
                            {e.from && <b className="text-foreground">{e.from} </b>}
                            {e.text}
                          </>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── wizard de criação/edição ─────────────────────────────────────────

type PresetKey = keyof typeof MATURATION_PRESETS;

const STEPS = ['Números', 'Ritmo', 'Revisão'] as const;

function PlanWizard({
  instances,
  initial,
  onClose,
}: {
  instances: Instance[];
  initial: MaturationPlanDTO | null;
  onClose: () => void;
}) {
  const create = useCreateMaturationPlan();
  const update = useUpdateMaturationPlan();
  const action = useMaturationAction();

  const [step, setStep] = useState(0);
  const [name, setName] = useState(initial?.name ?? '');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial?.instanceIds ?? []));
  const [config, setConfig] = useState<MaturationConfig>(() =>
    initial
      ? // preenche campos que planos antigos podem não ter (mídia/enquete/etc.)
        { ...MATURATION_PRESETS.standard, ...initial.config }
      : { ...MATURATION_PRESETS.standard, utcOffsetHours: browserUtcOffset() },
  );
  const [phrasesText, setPhrasesText] = useState(initial?.config.phrases?.join('\n') ?? '');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [err, setErr] = useState('');

  const eligible = instances.filter((i) => i.provider !== 'cloud');
  const cloudCount = instances.length - eligible.length;
  const selectedList = eligible.filter((i) => selected.has(i.id));
  const connectedSelected = selectedList.filter((i) => i.status === 'connected').length;

  /** qualquer ajuste manual vira preset "custom". */
  const patch = (p: Partial<MaturationConfig>) =>
    setConfig((c) => ({ ...c, ...p, intensity: 'custom' }));

  const applyPreset = (k: PresetKey) =>
    setConfig((c) => ({
      ...MATURATION_PRESETS[k],
      utcOffsetHours: c.utcOffsetHours,
      phrases: c.phrases,
    }));

  const toggle = (id: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const canNext =
    step === 0
      ? name.trim().length > 0 && selected.size >= 2
      : step === 1
        ? config.targetMessagesPerDay >= config.startMessagesPerDay &&
          config.maxDelaySec >= config.minDelaySec &&
          config.activeHours.end > config.activeHours.start
        : true;

  const buildBody = () => ({
    name: name.trim(),
    instanceIds: [...selected],
    config: {
      ...config,
      phrases: phrasesText
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    },
  });

  const submit = async (startAfter: boolean) => {
    setErr('');
    try {
      if (initial) {
        await update.mutateAsync({ id: initial.id, ...buildBody() });
        if (startAfter) await action.mutateAsync({ id: initial.id, action: 'start' });
      } else {
        const plan = await create.mutateAsync(buildBody());
        if (startAfter) await action.mutateAsync({ id: plan.id, action: 'start' });
      }
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const busy = create.isPending || update.isPending || action.isPending;
  const totalPerNumber = maturationTotalPerInstance(config);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92svh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* header + steps */}
        <div className="border-b px-5 py-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Sprout className="size-4 text-primary" />
              {initial ? `Editar plano — ${initial.name}` : 'Novo plano de maturação'}
            </h2>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <X className="size-4" />
            </button>
          </div>
          <div className="mt-2 flex items-center gap-2">
            {STEPS.map((s, i) => (
              <button
                key={s}
                onClick={() => i < step && setStep(i)}
                className={cn(
                  'flex items-center gap-1.5 text-xs',
                  i === step
                    ? 'font-medium text-foreground'
                    : i < step
                      ? 'text-primary'
                      : 'text-muted-foreground/60',
                )}
              >
                <span
                  className={cn(
                    'flex size-5 items-center justify-center rounded-full text-[10px] font-semibold',
                    i === step
                      ? 'bg-primary text-primary-foreground'
                      : i < step
                        ? 'bg-primary/20 text-primary'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {i + 1}
                </span>
                {s}
                {i < STEPS.length - 1 && <span className="mx-1 text-muted-foreground/40">—</span>}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {/* ── passo 1: números ── */}
          {step === 0 && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="plan-name">Nome do plano</Label>
                <Input
                  id="plan-name"
                  placeholder="ex.: aquecimento-lote-julho"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>
              <div>
                <p className="mb-1 text-sm font-medium">
                  Números do pool{' '}
                  <span className="font-normal text-muted-foreground">
                    ({selected.size} selecionado{selected.size === 1 ? '' : 's'} — mínimo 2)
                  </span>
                </p>
                <p className="mb-2 text-xs text-muted-foreground">
                  Eles vão conversar <b>entre si</b>. Números desconectados podem entrar no plano —
                  o motor espera até estarem conectados para incluí-los nas conversas.
                </p>
                {eligible.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                    Nenhuma instância elegível — crie instâncias baileys/webjs/whatsmeow na tela de
                    Instâncias.
                  </div>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {eligible.map((i) => {
                      const on = selected.has(i.id);
                      return (
                        <button
                          key={i.id}
                          onClick={() => toggle(i.id)}
                          className={cn(
                            'flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                            on ? 'border-primary bg-primary/5' : 'hover:bg-accent/50',
                          )}
                        >
                          <span
                            className={cn(
                              'flex size-4 shrink-0 items-center justify-center rounded border',
                              on
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'bg-background',
                            )}
                          >
                            {on && <CheckCheck className="size-3" />}
                          </span>
                          <span className={cn('size-2 shrink-0 rounded-full', connDot(i.status))} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{i.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {i.provider} · {i.status}
                              {i.wid ? ` · ${i.wid.split('@')[0].split(':')[0]}` : ''}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
                {cloudCount > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Info className="size-3.5" />
                    {cloudCount} instância(s) Cloud API ocultada(s): número oficial da Meta não
                    precisa (nem pode) ser maturado.
                  </p>
                )}
              </div>
            </>
          )}

          {/* ── passo 2: ritmo ── */}
          {step === 1 && (
            <>
              <div className="grid gap-2 sm:grid-cols-3">
                {(Object.keys(MATURATION_PRESETS) as PresetKey[]).map((k) => {
                  const meta = INTENSITY_META[k];
                  const on = config.intensity === k;
                  return (
                    <button
                      key={k}
                      onClick={() => applyPreset(k)}
                      className={cn(
                        'rounded-lg border p-3 text-left transition-colors',
                        on ? 'border-primary bg-primary/5' : 'hover:bg-accent/50',
                      )}
                    >
                      <div className="mb-1 flex items-center gap-1.5 text-sm font-medium">
                        <meta.icon
                          className={cn('size-4', on ? 'text-primary' : 'text-muted-foreground')}
                        />
                        {meta.label}
                      </div>
                      <div className="text-xs font-medium text-muted-foreground">
                        {meta.tagline}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground/80">{meta.blurb}</div>
                    </button>
                  );
                })}
              </div>
              {config.intensity === 'custom' && (
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Pencil className="size-3.5" /> Você personalizou os valores — preset “custom”.
                </p>
              )}

              <RampChart config={config} className="rounded-lg border p-3" />
              <p className="text-xs text-muted-foreground">
                Estimativa: <b className="text-foreground">{totalPerNumber}</b> mensagens por número
                na rampa toda ·{' '}
                <b className="text-foreground">{totalPerNumber * Math.max(selected.size, 2)}</b> no
                pool ({Math.max(selected.size, 2)} números).
              </p>

              <button
                className="flex items-center gap-1 text-xs font-medium text-primary"
                onClick={() => setShowAdvanced((s) => !s)}
              >
                {showAdvanced ? (
                  <ChevronUp className="size-3.5" />
                ) : (
                  <ChevronDown className="size-3.5" />
                )}
                Ajustes avançados
              </button>

              {showAdvanced && (
                <div className="space-y-4 rounded-lg border p-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <NumField
                      label="Dias de rampa"
                      value={config.durationDays}
                      min={1}
                      max={90}
                      onChange={(v) => patch({ durationDays: v })}
                      hint="Até o volume pleno."
                    />
                    <NumField
                      label="Msgs/dia inicial"
                      value={config.startMessagesPerDay}
                      min={1}
                      max={1000}
                      onChange={(v) => patch({ startMessagesPerDay: v })}
                      hint="Por número, no dia 1."
                    />
                    <NumField
                      label="Msgs/dia final"
                      value={config.targetMessagesPerDay}
                      min={1}
                      max={2000}
                      onChange={(v) => patch({ targetMessagesPerDay: v })}
                      hint="Por número, no último dia."
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-4">
                    <NumField
                      label="Janela: início"
                      value={config.activeHours.start}
                      min={0}
                      max={23}
                      onChange={(v) => patch({ activeHours: { ...config.activeHours, start: v } })}
                      hint="Hora local (0–23)."
                    />
                    <NumField
                      label="Janela: fim"
                      value={config.activeHours.end}
                      min={1}
                      max={24}
                      onChange={(v) => patch({ activeHours: { ...config.activeHours, end: v } })}
                      hint="Exclusivo (1–24)."
                    />
                    <NumField
                      label="Pausa mín. (s)"
                      value={config.minDelaySec}
                      min={5}
                      max={3600}
                      onChange={(v) => patch({ minDelaySec: v })}
                      hint="Entre conversas."
                    />
                    <NumField
                      label="Pausa máx. (s)"
                      value={config.maxDelaySec}
                      min={10}
                      max={7200}
                      onChange={(v) => patch({ maxDelaySec: v })}
                      hint="Sempre com jitter."
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <label className="flex items-center justify-between gap-2 rounded-lg border p-3">
                      <span>
                        <span className="block text-sm font-medium">Simular “digitando…”</span>
                        <span className="block text-xs text-muted-foreground">
                          Proporcional ao texto.
                        </span>
                      </span>
                      <Switch
                        checked={config.simulateTyping}
                        onCheckedChange={(v) => patch({ simulateTyping: v })}
                      />
                    </label>
                    <label className="flex items-center justify-between gap-2 rounded-lg border p-3">
                      <span>
                        <span className="block text-sm font-medium">Marcar como lido</span>
                        <span className="block text-xs text-muted-foreground">
                          O receptor “lê” a conversa.
                        </span>
                      </span>
                      <Switch
                        checked={config.markAsRead}
                        onCheckedChange={(v) => patch({ markAsRead: v })}
                      />
                    </label>
                    <div className="rounded-lg border p-3">
                      <span className="block text-sm font-medium">
                        Reações: {Math.round(config.reactionChance * 100)}%
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        step={5}
                        value={Math.round(config.reactionChance * 100)}
                        onChange={(e) => patch({ reactionChance: Number(e.target.value) / 100 })}
                        className="mt-2 w-full accent-[hsl(var(--primary))]"
                      />
                      <span className="block text-xs text-muted-foreground">
                        Chance de reagir com emoji.
                      </span>
                    </div>
                  </div>

                  {/* variedade de conteúdo: mídia (Pexels) + enquete + localização */}
                  <div className="space-y-3 rounded-lg border border-dashed p-3">
                    <div className="flex items-center gap-1.5 text-sm font-medium">
                      <ImageIcon className="size-4 text-primary" /> Variedade de conteúdo
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Além de texto, o motor intercala foto/vídeo (buscados no Pexels), enquetes e
                      localização — conversa só-texto é mais fácil de detectar. Cada tipo degrada
                      pra texto se a engine não suportar.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-lg border p-3">
                        <span className="block text-sm font-medium">
                          Mídia: {Math.round(config.mediaChance * 100)}%
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={60}
                          step={1}
                          value={Math.round(config.mediaChance * 100)}
                          onChange={(e) => patch({ mediaChance: Number(e.target.value) / 100 })}
                          className="mt-2 w-full accent-[hsl(var(--primary))]"
                        />
                        <span className="block text-xs text-muted-foreground">
                          Chance de foto/vídeo por mensagem.
                        </span>
                      </div>
                      <div className="rounded-lg border p-3">
                        <span className="block text-sm font-medium">
                          Enquete: {Math.round(config.pollChance * 100)}%
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={40}
                          step={1}
                          value={Math.round(config.pollChance * 100)}
                          onChange={(e) => patch({ pollChance: Number(e.target.value) / 100 })}
                          className="mt-2 w-full accent-[hsl(var(--primary))]"
                        />
                        <span className="block text-xs text-muted-foreground">
                          Perguntas casuais com opções.
                        </span>
                      </div>
                      <div className="rounded-lg border p-3">
                        <span className="block text-sm font-medium">
                          Localização: {Math.round(config.locationChance * 100)}%
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={40}
                          step={1}
                          value={Math.round(config.locationChance * 100)}
                          onChange={(e) => patch({ locationChance: Number(e.target.value) / 100 })}
                          className="mt-2 w-full accent-[hsl(var(--primary))]"
                        />
                        <span className="block text-xs text-muted-foreground">
                          Pontos conhecidos do Brasil.
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">Tipos de mídia:</span>
                      {(['image', 'video'] as const).map((t) => {
                        const on = config.mediaTypes.includes(t);
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() =>
                              patch({
                                mediaTypes: on
                                  ? config.mediaTypes.filter((x) => x !== t)
                                  : [...config.mediaTypes, t],
                              })
                            }
                            className={cn(
                              'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors',
                              on
                                ? 'border-primary bg-primary/5 text-foreground'
                                : 'text-muted-foreground',
                            )}
                          >
                            {t === 'image' ? (
                              <ImageIcon className="size-3.5" />
                            ) : (
                              <Video className="size-3.5" />
                            )}
                            {t === 'image' ? 'Foto' : 'Vídeo'}
                          </button>
                        );
                      })}
                    </div>
                    <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <Info className="mt-0.5 size-3.5 shrink-0" />
                      Foto/vídeo precisam da variável{' '}
                      <code className="rounded bg-muted px-1">PEXELS_API_KEY</code> no servidor
                      (chave grátis em pexels.com/api). Sem ela, só enquete/localização e texto são
                      enviados.
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="phrases">Frases extras (uma por linha — opcional)</Label>
                    <textarea
                      id="phrases"
                      rows={4}
                      value={phrasesText}
                      onChange={(e) => setPhrasesText(e.target.value)}
                      placeholder={
                        'Bom dia! Como foi o fim de semana?\nDepois te mando aquele arquivo.'
                      }
                      className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <p className="text-xs text-muted-foreground">
                      Misturadas ao banco padrão de conversas casuais em PT-BR. Quanto mais variado
                      o conteúdo, mais natural o padrão.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── passo 3: revisão ── */}
          {step === 2 && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Plano</p>
                    <p className="text-sm font-medium">{name}</p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      Números ({selectedList.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedList.map((i) => (
                        <span
                          key={i.id}
                          className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground"
                        >
                          <span className={cn('size-1.5 rounded-full', connDot(i.status))} />
                          {i.name}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Ritmo</p>
                    <ul className="space-y-0.5 text-sm">
                      <li>
                        <b>{INTENSITY_META[config.intensity].label}</b> — {config.durationDays}{' '}
                        dias, {config.startMessagesPerDay} → {config.targetMessagesPerDay} msgs/dia
                        por número
                      </li>
                      <li className="text-muted-foreground">
                        Janela {fmtHour(config.activeHours.start)}–{fmtHour(config.activeHours.end)}{' '}
                        (UTC{(config.utcOffsetHours ?? 0) >= 0 ? '+' : ''}
                        {config.utcOffsetHours ?? 0}) · pausas de {config.minDelaySec}–
                        {config.maxDelaySec}s
                      </li>
                      <li className="text-muted-foreground">
                        {config.simulateTyping ? 'Simula digitação' : 'Sem digitação'} ·{' '}
                        {config.markAsRead ? 'marca como lido' : 'não marca lido'} · reações{' '}
                        {Math.round(config.reactionChance * 100)}%
                      </li>
                      <li className="text-muted-foreground">
                        Conteúdo: texto
                        {config.mediaChance > 0 && config.mediaTypes.length
                          ? ` · ${config.mediaTypes.map((t) => (t === 'image' ? 'foto' : 'vídeo')).join('/')} ${Math.round(config.mediaChance * 100)}%`
                          : ''}
                        {config.pollChance > 0
                          ? ` · enquete ${Math.round(config.pollChance * 100)}%`
                          : ''}
                        {config.locationChance > 0
                          ? ` · localização ${Math.round(config.locationChance * 100)}%`
                          : ''}
                      </li>
                    </ul>
                  </div>
                </div>
                <RampChart config={config} className="rounded-lg border p-3" />
              </div>

              {connectedSelected < 2 && (
                <div className="flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <span>
                    Apenas {connectedSelected} número(s) selecionado(s) está(ão) conectado(s). Você
                    pode iniciar mesmo assim — o motor <b>espera</b> até ter 2 conectados para
                    começar a conversar (acompanhe no feed do plano).
                  </span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Os envios da maturação passam pelo mesmo rate-limit anti-ban das instâncias e
                aparecem no Inbox/Logs como qualquer mensagem.
              </p>
            </>
          )}

          {err && <p className="text-sm text-destructive">{err}</p>}
        </div>

        {/* footer de navegação */}
        <div className="flex items-center justify-between border-t px-5 py-3">
          <Button variant="ghost" onClick={() => (step === 0 ? onClose() : setStep(step - 1))}>
            {step === 0 ? (
              'Cancelar'
            ) : (
              <>
                <ArrowLeft className="size-3.5" /> Voltar
              </>
            )}
          </Button>
          <div className="flex items-center gap-2">
            {step < 2 ? (
              <Button disabled={!canNext} onClick={() => setStep(step + 1)}>
                Avançar <ArrowRight className="size-3.5" />
              </Button>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={() => submit(false)}>
                  {initial ? 'Salvar' : 'Criar rascunho'}
                </Button>
                <Button disabled={busy} onClick={() => submit(true)}>
                  <Play className="size-3.5" /> {initial ? 'Salvar e iniciar' : 'Criar e iniciar'}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function NumField({
  label,
  value,
  min,
  max,
  onChange,
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
  hint?: string;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-8"
      />
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

// ── página ───────────────────────────────────────────────────────────

export function MaturationPage() {
  const plans = useMaturationPlans();
  const instances = useInstances();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<MaturationPlanDTO | null>(null);

  const openCreate = () => {
    setEditing(null);
    setWizardOpen(true);
  };
  const openEdit = (p: MaturationPlanDTO) => {
    setEditing(p);
    setWizardOpen(true);
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-lg font-semibold">Maturação</h1>
          <p className="text-sm text-muted-foreground">
            Aqueça números novos colocando-os para conversar entre si, com rampa e padrão humano.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="size-4" /> Novo plano
        </Button>
      </div>

      <Explainer />

      {plans.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {plans.isError && (
        <Card>
          <CardContent className="py-6 text-sm text-destructive">
            Erro ao carregar planos: {(plans.error as Error).message}
          </CardContent>
        </Card>
      )}

      {plans.data && plans.data.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <Sprout className="size-10 text-muted-foreground/40" />
            <div>
              <p className="font-medium">Nenhum plano de maturação ainda</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Selecione 2+ números e deixe o WAMux conversar entre eles por alguns dias antes de
                colocá-los na operação real.
              </p>
            </div>
            <Button onClick={openCreate}>
              <Plus className="size-4" /> Criar o primeiro plano
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-4">
        {plans.data?.map((p) => (
          <PlanCard key={p.id} plan={p} onEdit={openEdit} />
        ))}
      </div>

      {wizardOpen && (
        <PlanWizard
          instances={instances.data ?? []}
          initial={editing}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
