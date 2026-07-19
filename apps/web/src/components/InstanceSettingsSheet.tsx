import { useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Check, Info, KeyRound, Radio, Rss, Save, Webhook as WebhookIcon } from 'lucide-react';
import type { InstanceEventsConfig } from '@wamux/shared';
import { EMPTY_EVENTS_CONFIG } from '@wamux/shared';
import { Instance, WEBHOOK_EVENTS, useSetEvents } from '@/api';
import { ApiKeysSection } from '@/components/ApiKeysSection';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

type Section = 'webhook' | 'websocket' | 'rabbitmq' | 'apikeys';

const EVENTS_NAV: {
  id: 'webhook' | 'websocket' | 'rabbitmq';
  label: string;
  icon: typeof WebhookIcon;
}[] = [
  { id: 'webhook', label: 'Webhook', icon: WebhookIcon },
  { id: 'websocket', label: 'WebSocket', icon: Radio },
  { id: 'rabbitmq', label: 'RabbitMQ', icon: Rss },
];

/** Config inicial: usa a da instância; senão, vazia. */
function initialConfig(inst: Instance): InstanceEventsConfig {
  const e = inst.events;
  return {
    webhook: e?.webhook ?? { ...EMPTY_EVENTS_CONFIG.webhook },
    websocket: e?.websocket ?? { ...EMPTY_EVENTS_CONFIG.websocket },
    rabbitmq: e?.rabbitmq ?? { ...EMPTY_EVENTS_CONFIG.rabbitmq },
  };
}

/**
 * Drawer de configurações da instância. Grupo "Eventos" com
 * submenus Webhook / WebSocket / RabbitMQ. Um único `config` é compartilhado
 * pelas 3 seções e salvo inteiro (o PUT /events grava tudo).
 */
export function InstanceSettingsSheet({
  instance,
  onClose,
}: {
  instance: Instance;
  onClose: () => void;
}) {
  const [section, setSection] = useState<Section>('webhook');
  const [config, setConfig] = useState<InstanceEventsConfig>(() => initialConfig(instance));
  const save = useSetEvents();
  const [savedAt, setSavedAt] = useState<Section | null>(null);

  const doSave = (which: Section) => {
    setSavedAt(null);
    save.mutate({ id: instance.id, config }, { onSuccess: () => setSavedAt(which) });
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-3xl">
        <SheetHeader className="border-b p-6 text-left">
          <SheetTitle>Configurações — {instance.name}</SheetTitle>
          <SheetDescription>
            Entrega de eventos por Webhook, WebSocket ou RabbitMQ.
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1">
          <nav className="w-44 shrink-0 space-y-1 border-r p-2 sm:w-52">
            <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">
              Eventos
            </p>
            {EVENTS_NAV.map((s) => {
              const on = config[s.id].enabled;
              return (
                <button
                  key={s.id}
                  onClick={() => setSection(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    section === s.id
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <s.icon className="size-4" />
                  {s.label}
                  <span
                    className={cn(
                      'ml-auto size-1.5 rounded-full',
                      on ? 'bg-emerald-500' : 'bg-muted-foreground/30',
                    )}
                    title={on ? 'ativo' : 'inativo'}
                  />
                </button>
              );
            })}
            <p className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">
              Segurança
            </p>
            <button
              onClick={() => setSection('apikeys')}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                section === 'apikeys'
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
              )}
            >
              <KeyRound className="size-4" />
              API keys
            </button>
          </nav>

          <div className="min-w-0 flex-1 overflow-auto p-6">
            {section === 'webhook' && (
              <WebhookSection
                config={config}
                setConfig={setConfig}
                onSave={() => doSave('webhook')}
                saving={save.isPending}
                saved={savedAt === 'webhook'}
                error={save.isError ? (save.error as Error).message : ''}
              />
            )}
            {section === 'websocket' && (
              <WebSocketSection
                instance={instance}
                config={config}
                setConfig={setConfig}
                onSave={() => doSave('websocket')}
                saving={save.isPending}
                saved={savedAt === 'websocket'}
              />
            )}
            {section === 'rabbitmq' && (
              <RabbitMqSection
                instance={instance}
                config={config}
                setConfig={setConfig}
                onSave={() => doSave('rabbitmq')}
                saving={save.isPending}
                saved={savedAt === 'rabbitmq'}
              />
            )}
            {section === 'apikeys' && <ApiKeysSection instance={instance} />}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── infra compartilhada ──────────────────────────────────────

type SectionProps = {
  config: InstanceEventsConfig;
  setConfig: Dispatch<SetStateAction<InstanceEventsConfig>>;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
};

const GROUPED = WEBHOOK_EVENTS.reduce<Record<string, typeof WEBHOOK_EVENTS>>((acc, ev) => {
  (acc[ev.category] ??= []).push(ev);
  return acc;
}, {});

/** Toggle de habilitar de um transporte. */
function EnableRow({
  id,
  label,
  hint,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-4">
      <div className="pr-4">
        <Label htmlFor={id} className="text-sm font-medium">
          {label}
        </Label>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/** Seletor de eventos (checkboxes agrupados) reutilizado pelos 3 transportes. */
function EventsPicker({
  events,
  onChange,
  disabled,
}: {
  events: string[];
  onChange: (events: string[]) => void;
  disabled?: boolean;
}) {
  const toggle = (v: string) =>
    onChange(events.includes(v) ? events.filter((e) => e !== v) : [...events, v]);

  return (
    <div className={cn('space-y-3', disabled && 'pointer-events-none opacity-50')}>
      <div className="flex items-baseline justify-between">
        <Label>Eventos</Label>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">
            {events.length === 0 ? 'todos' : `${events.length} de ${WEBHOOK_EVENTS.length}`}
          </span>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onChange(WEBHOOK_EVENTS.map((e) => e.value))}
          >
            todos
          </button>
          <span className="text-muted-foreground/40">·</span>
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onChange([])}
          >
            limpar
          </button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Nenhum marcado = recebe <b>todos</b>.
      </p>
      {Object.entries(GROUPED).map(([category, evs]) => (
        <div key={category} className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground/70">
            {category}
          </p>
          {evs.map((ev) => {
            const checked = events.includes(ev.value);
            return (
              <button
                key={ev.value}
                type="button"
                onClick={() => toggle(ev.value)}
                className="flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:bg-accent/50"
              >
                <span
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {checked && <Check className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{ev.label}</span>
                    <code className="rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                      {ev.value}
                    </code>
                  </span>
                  <span className="block text-xs text-muted-foreground">{ev.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function SaveBar({
  onSave,
  saving,
  saved,
  disabled,
  error,
}: {
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <div className="flex items-center gap-3 border-t pt-4">
      <Button onClick={onSave} disabled={saving || disabled}>
        <Save /> Salvar
      </Button>
      {saved && (
        <span className="flex items-center gap-1 text-sm text-primary">
          <Check className="size-4" /> Salvo
        </span>
      )}
      {error && <span className="text-sm text-destructive">{error}</span>}
    </div>
  );
}

function InfoBox({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
      <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground/70" />
      <div className="min-w-0 space-y-1">{children}</div>
    </div>
  );
}

// ── seções ───────────────────────────────────────────────────

function WebhookSection({
  config,
  setConfig,
  onSave,
  saving,
  saved,
  error,
}: SectionProps & { error: string }) {
  const wh = config.webhook;
  const patch = (p: Partial<typeof wh>) =>
    setConfig((c) => ({ ...c, webhook: { ...c.webhook, ...p } }));

  return (
    <div className="max-w-xl space-y-6">
      <EnableRow
        id="wh-on"
        label="Webhook"
        hint="Entrega cada evento via HTTP POST na sua URL."
        checked={wh.enabled}
        onChange={(v) => patch({ enabled: v })}
      />
      <div className={cn('space-y-5', !wh.enabled && 'pointer-events-none opacity-50')}>
        <div className="space-y-1.5">
          <Label htmlFor="wh-url">URL de destino</Label>
          <Input
            id="wh-url"
            value={wh.url}
            onChange={(e) => patch({ url: e.target.value })}
            placeholder="https://meu-app.com/webhook"
          />
        </div>
        <EventsPicker events={wh.events} onChange={(events) => patch({ events })} />
      </div>
      <SaveBar
        onSave={onSave}
        saving={saving}
        saved={saved}
        error={error}
        disabled={wh.enabled && !wh.url.trim()}
      />
    </div>
  );
}

function WebSocketSection({
  instance,
  config,
  setConfig,
  onSave,
  saving,
  saved,
}: SectionProps & { instance: Instance }) {
  const ws = config.websocket;
  const patch = (p: Partial<typeof ws>) =>
    setConfig((c) => ({ ...c, websocket: { ...c.websocket, ...p } }));

  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
  const wsUrl = `ws://${host}:3000/events?instance=${instance.id}&apikey=SUA_API_KEY`;

  return (
    <div className="max-w-xl space-y-6">
      <EnableRow
        id="ws-on"
        label="WebSocket"
        hint="Stream em tempo real: seu app conecta e recebe os eventos na hora."
        checked={ws.enabled}
        onChange={(v) => patch({ enabled: v })}
      />
      <InfoBox>
        <p>Conecte um cliente WebSocket em:</p>
        <code className="block overflow-x-auto whitespace-nowrap rounded bg-background px-2 py-1 text-[11px] text-foreground">
          {wsUrl}
        </code>
        <p>
          A <code>apikey</code> pode ser a da instância ou a GLOBAL_API_KEY. Cada mensagem chega
          como <code>{'{ instanceId, event, data, timestamp }'}</code>.
        </p>
      </InfoBox>
      <div className={cn(!ws.enabled && 'pointer-events-none opacity-50')}>
        <EventsPicker events={ws.events} onChange={(events) => patch({ events })} />
      </div>
      <SaveBar onSave={onSave} saving={saving} saved={saved} />
    </div>
  );
}

function RabbitMqSection({
  instance,
  config,
  setConfig,
  onSave,
  saving,
  saved,
}: SectionProps & { instance: Instance }) {
  const rb = config.rabbitmq;
  const patch = (p: Partial<typeof rb>) =>
    setConfig((c) => ({ ...c, rabbitmq: { ...c.rabbitmq, ...p } }));

  return (
    <div className="max-w-xl space-y-6">
      <EnableRow
        id="rb-on"
        label="RabbitMQ"
        hint="Publica cada evento no broker, por routing key."
        checked={rb.enabled}
        onChange={(v) => patch({ enabled: v })}
      />
      <InfoBox>
        <p>
          Exchange <code>wamux.events</code> (tipo <code>topic</code>). Routing key de cada evento:
        </p>
        <code className="block overflow-x-auto whitespace-nowrap rounded bg-background px-2 py-1 text-[11px] text-foreground">
          {instance.id}.&lt;evento&gt;
        </code>
        <p>
          Faça bind da sua fila com, ex.: <code>{instance.id}.#</code> (tudo dessa instância) ou{' '}
          <code>*.message.received</code> (só recebidas, todas as instâncias).
        </p>
      </InfoBox>
      <div className={cn(!rb.enabled && 'pointer-events-none opacity-50')}>
        <EventsPicker events={rb.events} onChange={(events) => patch({ events })} />
      </div>
      <SaveBar onSave={onSave} saving={saving} saved={saved} />
    </div>
  );
}
