import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Check,
  Database,
  KeyRound,
  Loader2,
  Monitor,
  Moon,
  Palette,
  Save,
  Send,
  Smartphone,
  Sun,
  Webhook,
} from 'lucide-react';
import type { SystemService, WamuxSettings } from '@wamux/shared';
import { clearApiKey, useInstances, useSettings, useSystemInfo, useUpdateSettings } from '@/api';
import { ApiKeysSection } from '@/components/ApiKeysSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const THEME_KEY = 'wamux_theme';

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
}

type SectionId =
  'appearance' | 'sending' | 'webhook' | 'device' | 'system' | 'persistence' | 'apikeys' | 'auth';

/**
 * Navegação espelha a do `InstanceSettingsSheet` (mesmos grupos, mesmos
 * estilos) para que as duas telas de configuração se pareçam. Os grupos
 * separam o que é EDITÁVEL (aparência, envio, integrações) do que é
 * DIAGNÓSTICO — o segundo bloco não tem botão de salvar.
 */
const NAV: { group: string; items: { id: SectionId; label: string; icon: typeof Palette }[] }[] = [
  {
    group: 'Painel',
    items: [{ id: 'appearance', label: 'Aparência', icon: Palette }],
  },
  {
    group: 'Envio',
    items: [
      { id: 'sending', label: 'Rate limit', icon: Send },
      { id: 'device', label: 'Dispositivo', icon: Smartphone },
    ],
  },
  {
    group: 'Integrações',
    items: [{ id: 'webhook', label: 'Webhook global', icon: Webhook }],
  },
  {
    group: 'Sistema',
    items: [
      { id: 'system', label: 'Diagnóstico', icon: Activity },
      { id: 'persistence', label: 'Persistência', icon: Database },
    ],
  },
  {
    group: 'Segurança',
    items: [
      { id: 'apikeys', label: 'Chaves de API', icon: KeyRound },
      { id: 'auth', label: 'Acesso do painel', icon: Monitor },
    ],
  },
];

/** Seções que editam `WamuxSettings` — só nelas a barra de salvar faz sentido. */
const EDITABLE: SectionId[] = ['sending', 'webhook', 'device'];

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const [section, setSection] = useState<SectionId>('appearance');
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const { data } = useSettings();
  const update = useUpdateSettings();
  const [form, setForm] = useState<WamuxSettings | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  // Comparação por serialização: o objeto é pequeno e raso, então não vale
  // um deep-equal manual — e sem isso o botão Salvar ficaria sempre ativo,
  // sem indicar se há algo pendente.
  const dirty = useMemo(
    () => !!form && !!data && JSON.stringify(form) !== JSON.stringify(data),
    [form, data],
  );

  const patch = <S extends keyof WamuxSettings, K extends keyof WamuxSettings[S]>(
    section: S,
    key: K,
    value: WamuxSettings[S][K],
  ) => setForm((f) => (f ? { ...f, [section]: { ...f[section], [key]: value } } : f));

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next);
  };

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col">
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border">
        <nav className="w-44 shrink-0 space-y-1 overflow-y-auto border-r p-2 sm:w-52">
          {NAV.map((g) => (
            <div key={g.group}>
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground/60">
                {g.group}
              </p>
              {g.items.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setSection(item.id)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
                    section === item.id
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                  {EDITABLE.includes(item.id) && dirty && (
                    <span
                      className="ml-auto size-1.5 rounded-full bg-amber-500"
                      title="alterações não salvas"
                    />
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto p-6">
          {section === 'appearance' && (
            <Section title="Aparência" description="Tema do painel, guardado neste navegador.">
              <Button variant="outline" onClick={toggleTheme}>
                {dark ? <Moon /> : <Sun />}
                {dark ? 'Tema escuro' : 'Tema claro'}
              </Button>
            </Section>
          )}

          {section === 'sending' && form && (
            <Section
              title="Rate limit"
              description="Ritmo de envio por instância (token bucket). O excedente vai para a fila em vez de ser descartado."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="rl-persec" label="Msgs por segundo">
                  <Input
                    id="rl-persec"
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={form.rateLimit.perSec}
                    onChange={(e) => patch('rateLimit', 'perSec', Number(e.target.value))}
                  />
                </Field>
                <Field id="rl-burst" label="Rajada (burst)">
                  <Input
                    id="rl-burst"
                    type="number"
                    min="1"
                    value={form.rateLimit.burst}
                    onChange={(e) => patch('rateLimit', 'burst', Number(e.target.value))}
                  />
                </Field>
              </div>
            </Section>
          )}

          {section === 'webhook' && form && (
            <Section
              title="Webhook global"
              description="Aplicado às instâncias que não têm webhook próprio."
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between rounded-md border px-3 py-2">
                  <Label htmlFor="wh-enabled">Habilitar webhook global</Label>
                  <Switch
                    id="wh-enabled"
                    checked={form.webhookGlobal.enabled}
                    onCheckedChange={(v) => patch('webhookGlobal', 'enabled', v)}
                  />
                </div>
                <Field id="wh-url" label="URL de destino">
                  <Input
                    id="wh-url"
                    placeholder="https://meu-app.com/webhook"
                    value={form.webhookGlobal.url}
                    onChange={(e) => patch('webhookGlobal', 'url', e.target.value)}
                  />
                </Field>
              </div>
            </Section>
          )}

          {section === 'device' && form && (
            <Section
              title="Identidade do dispositivo"
              description='Como a sessão aparece no WhatsApp em "Aparelhos conectados" (Baileys). Vale a partir do próximo connect.'
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="dv-client" label="Cliente">
                  <Input
                    id="dv-client"
                    value={form.device.client}
                    onChange={(e) => patch('device', 'client', e.target.value)}
                  />
                </Field>
                <Field id="dv-browser" label="Navegador">
                  <Input
                    id="dv-browser"
                    value={form.device.browser}
                    onChange={(e) => patch('device', 'browser', e.target.value)}
                  />
                </Field>
              </div>
            </Section>
          )}

          {section === 'system' && <SystemSection />}
          {section === 'persistence' && <PersistenceSection />}
          {section === 'apikeys' && <ApiKeysPicker />}

          {section === 'auth' && (
            <Section
              title="Acesso do painel"
              description="O painel guarda a GLOBAL_API_KEY neste navegador para falar com o gateway."
            >
              <Button
                variant="destructive"
                onClick={() => {
                  clearApiKey();
                  onLogout();
                }}
              >
                <KeyRound /> Trocar API key
              </Button>
            </Section>
          )}
        </div>
      </div>

      {/* Barra de salvar: só aparece com alterações pendentes, e some nas
          seções que não editam nada — evita um botão inerte no rodapé. */}
      {dirty && form && EDITABLE.includes(section) && (
        <div className="mt-3 flex items-center gap-3 rounded-lg border bg-card px-4 py-3">
          <span className="flex items-center gap-2 text-sm">
            <span className="size-1.5 rounded-full bg-amber-500" />
            Alterações não salvas
          </span>
          {update.isError && (
            <span className="text-sm text-destructive">{(update.error as Error).message}</span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => data && setForm(data)}>
              Descartar
            </Button>
            <Button onClick={() => update.mutate(form)} disabled={update.isPending}>
              {update.isPending ? <Loader2 className="animate-spin" /> : <Save />}
              Salvar
            </Button>
          </div>
        </div>
      )}
      {!dirty && update.isSuccess && (
        <p className="mt-3 flex items-center gap-1 px-1 text-sm text-primary">
          <Check className="size-4" /> Configurações salvas
        </p>
      )}
    </div>
  );
}

// ── seções de leitura ────────────────────────────────────────

function SystemSection() {
  const { data, isLoading } = useSystemInfo();
  return (
    <Section
      title="Diagnóstico"
      description="Estado das dependências do gateway. Atualiza sozinho a cada 30s."
    >
      {isLoading || !data ? (
        <p className="text-sm text-muted-foreground">Consultando serviços…</p>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-3 gap-3">
            <Stat label="Versão" value={data.version} />
            <Stat label="Ambiente" value={data.env} />
            <Stat label="Worker" value={data.workerId} />
          </dl>
          <div className="divide-y rounded-md border">
            {data.services.map((s) => (
              <ServiceRow key={s.name} service={s} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Limite de mídia por envio: <b>{data.media.maxSizeMb} MB</b>.
          </p>
        </div>
      )}
    </Section>
  );
}

const SERVICE_ROLE: Record<string, string> = {
  postgres: 'instâncias, mensagens e sessões',
  redis: 'rate limit, registro de instâncias e filas',
  rabbitmq: 'transporte de eventos (opcional)',
  whatsmeow: 'sidecar Go (hypermeow, fork do whatsmeow)',
  ffmpeg: 'nota de voz (ogg/opus)',
};

function ServiceRow({ service }: { service: SystemService }) {
  const up = service.status === 'up';
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span
        className={cn(
          'size-2 shrink-0 rounded-full',
          up
            ? 'bg-emerald-500'
            : service.status === 'down'
              ? 'bg-destructive'
              : 'bg-muted-foreground/40',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{service.name}</div>
        <div className="truncate text-xs text-muted-foreground">{SERVICE_ROLE[service.name]}</div>
      </div>
      <div className="max-w-[45%] truncate text-right text-xs text-muted-foreground">
        {service.detail ?? (up ? 'ok' : '—')}
      </div>
    </div>
  );
}

function PersistenceSection() {
  const { data, isLoading } = useSystemInfo();
  const flags = data?.persistence;
  return (
    <Section
      title="Persistência"
      description="O que o gateway grava no banco. São somente leitura aqui: mudam por variável de ambiente e exigem restart."
    >
      {isLoading || !flags ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="space-y-4">
          <div className="divide-y rounded-md border">
            <FlagRow
              on={flags.contacts}
              env="DATABASE_SAVE_DATA_CONTACTS"
              label="Conversas e contatos"
              hint="Sem isto, a lista do Inbox fica vazia."
            />
            <FlagRow
              on={flags.newMessage}
              env="DATABASE_SAVE_DATA_NEW_MESSAGE"
              label="Histórico de mensagens"
              hint="Sem isto, a thread do Inbox não guarda mensagens."
            />
            <FlagRow
              on={flags.messageUpdate}
              env="DATABASE_SAVE_MESSAGE_UPDATE"
              label="Status e reações"
              hint="Recibos (✓✓) e o emoji de reação na mensagem."
            />
            <FlagRow
              on={flags.storeMediaBody}
              env="DATABASE_SAVE_MEDIA_BODY"
              label="Corpo das mídias"
              hint="Guarda o arquivo recebido para reexibir na thread."
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Retenção de mensagens:{' '}
            <b>{flags.retentionDays === 0 ? 'sem expurgo' : `${flags.retentionDays} dias`}</b>.
          </p>
        </div>
      )}
    </Section>
  );
}

function FlagRow({
  on,
  env,
  label,
  hint,
}: {
  on: boolean;
  env: string;
  label: string;
  hint: string;
}) {
  return (
    <div className="flex items-start gap-3 px-3 py-2.5">
      <span
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          on ? 'bg-emerald-500' : 'bg-muted-foreground/30',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">{hint}</div>
        <code className="text-[11px] text-muted-foreground/70">{env}</code>
      </div>
      <span
        className={cn('text-xs font-medium', on ? 'text-emerald-600' : 'text-muted-foreground')}
      >
        {on ? 'ligado' : 'desligado'}
      </span>
    </div>
  );
}

/**
 * As chaves escopadas pertencem a UMA instância (o backend as endereça por
 * `instances/:id/api-keys`), então aqui só escolhemos a instância e
 * reaproveitamos o `ApiKeysSection` que a gaveta da instância já usa — em vez
 * de manter duas telas equivalentes.
 */
function ApiKeysPicker() {
  const { data: instances } = useInstances();
  const [id, setId] = useState('');
  const selected = instances?.find((i) => i.id === id);

  return (
    <Section
      title="Chaves de API"
      description="Chaves com escopo, por instância — úteis para dar acesso parcial a um integrador sem entregar a key mestra."
    >
      <div className="space-y-5">
        <Field id="ak-instance" label="Instância">
          <select
            id="ak-instance"
            value={id}
            onChange={(e) => setId(e.target.value)}
            className="h-9 w-full max-w-md rounded-md border border-input bg-transparent px-2 text-sm"
          >
            <option value="">— selecione —</option>
            {(instances ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} ({i.provider})
              </option>
            ))}
          </select>
        </Field>
        {selected ? (
          <ApiKeysSection instance={selected} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Escolha uma instância para ver e criar chaves.
          </p>
        )}
      </div>
    </Section>
  );
}

// ── primitivos de layout ─────────────────────────────────────

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <h2 className="font-display text-lg font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </div>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{value}</dd>
    </div>
  );
}
