import { AlertTriangle, CheckCheck, MessageSquare, PlugZap, Send, Webhook } from 'lucide-react';
import { PROVIDERS } from '@wamux/shared';
import { useInstances, useStats } from '@/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const fmt = (n: number) => n.toLocaleString('pt-BR');
const pct = (n: number) => `${Math.round(n * 100)}%`;

const STATUS_LABEL: Record<string, string> = {
  connected: 'Conectada',
  connecting: 'Conectando',
  qr: 'Aguardando QR',
  qr_expired: 'QR expirado',
  pairing: 'Pareando',
  passkey_pending: 'Passkey',
  disconnected: 'Desconectada',
  logged_out: 'Deslogada',
};

function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'default',
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: typeof Send;
  tone?: 'default' | 'good' | 'warn';
}) {
  const color =
    tone === 'good'
      ? 'text-emerald-500'
      : tone === 'warn'
        ? 'text-amber-500'
        : 'text-muted-foreground';
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`size-4 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
        {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function FunnelRow({
  label,
  value,
  base,
  className,
}: {
  label: string;
  value: number;
  base: number;
  className: string;
}) {
  const p = base ? (value / base) * 100 : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {fmt(value)} · {Math.round(p)}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full rounded-full ${className}`} style={{ width: `${p}%` }} />
      </div>
    </div>
  );
}

/** Preenche os últimos 14 dias (UTC), zerando os sem dado — série sempre com 14 colunas. */
function last14Days(data: { date: string; sent: number; received: number }[]) {
  const map = new Map(data.map((d) => [d.date, d]));
  const now = new Date();
  const out: { date: string; sent: number; received: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    out.push(map.get(key) ?? { date: key, sent: 0, received: 0 });
  }
  return out;
}

function DailyBars({ data }: { data: { date: string; sent: number; received: number }[] }) {
  const days = last14Days(data);
  const max = Math.max(1, ...days.map((d) => Math.max(d.sent, d.received)));
  return (
    <div className="flex h-32 items-stretch gap-1">
      {days.map((d) => (
        <div
          key={d.date}
          className="flex flex-1 items-end justify-center gap-0.5 rounded bg-muted/40"
          title={`${d.date.slice(5)} · ${d.sent} enviadas · ${d.received} recebidas`}
        >
          <div
            className="w-1/2 rounded-t bg-primary"
            style={{ height: `${(d.sent / max) * 100}%` }}
          />
          <div
            className="w-1/2 rounded-t bg-sky-400"
            style={{ height: `${(d.received / max) * 100}%` }}
          />
        </div>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { data: instances } = useInstances();
  const { data: stats } = useStats();
  const list = instances ?? [];

  const statusOf = (i: (typeof list)[number]) => i.liveStatus ?? i.status;
  const total = list.length;
  const connected = list.filter((i) => statusOf(i) === 'connected').length;
  const byStatus = list.reduce<Record<string, number>>((acc, i) => {
    const s = statusOf(i);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});
  const attention = list.filter((i) =>
    ['disconnected', 'logged_out', 'qr_expired'].includes(statusOf(i)),
  );
  const events = list.reduce(
    (acc, i) => {
      if (i.events?.webhook?.enabled) acc.webhook++;
      if (i.events?.websocket?.enabled) acc.websocket++;
      if (i.events?.rabbitmq?.enabled) acc.rabbitmq++;
      return acc;
    },
    { webhook: 0, websocket: 0, rabbitmq: 0 },
  );

  const perEngine = PROVIDERS.map((p) => ({
    ...p,
    count: list.filter((i) => i.provider === p.value).length,
  }));

  const m = stats?.messages;
  const w = stats?.webhooks;
  const ack = m?.ack;
  const reached = ack ? ack.server + ack.delivered + ack.read + ack.played : 0;
  const deliveredCount = ack ? ack.delivered + ack.read + ack.played : 0;
  const readCount = ack ? ack.read + ack.played : 0;

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Instâncias conectadas"
          value={`${connected}/${total}`}
          hint={total ? `${pct(total ? connected / total : 0)} online` : 'nenhuma instância'}
          icon={PlugZap}
          tone={connected === total && total > 0 ? 'good' : attention.length ? 'warn' : 'default'}
        />
        <StatCard
          label="Mensagens hoje"
          value={m ? fmt(m.today.sent + m.today.received) : '—'}
          hint={
            m ? `${fmt(m.today.sent)} enviadas · ${fmt(m.today.received)} recebidas` : undefined
          }
          icon={MessageSquare}
        />
        <StatCard
          label="Taxa de entrega"
          value={m ? pct(m.deliveryRate) : '—'}
          hint={m ? `leitura ${pct(m.readRate)}` : undefined}
          icon={CheckCheck}
          tone={
            m && m.deliveryRate >= 0.9 ? 'good' : m && m.deliveryRate < 0.6 ? 'warn' : 'default'
          }
        />
        <StatCard
          label="Webhooks"
          value={w ? pct(w.successRate) : '—'}
          hint={w ? `DLQ: ${fmt(w.dlq)} · pendentes: ${fmt(w.pending)}` : undefined}
          icon={Webhook}
          tone={w && w.dlq > 0 ? 'warn' : w ? 'good' : 'default'}
        />
      </div>

      {/* Funil + série diária */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send className="size-4 text-primary" /> Funil de entrega (enviadas)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {m ? (
              <>
                <FunnelRow label="Enviadas" value={m.sent} base={m.sent} className="bg-primary" />
                <FunnelRow
                  label="No servidor"
                  value={reached}
                  base={m.sent}
                  className="bg-sky-500"
                />
                <FunnelRow
                  label="Entregues"
                  value={deliveredCount}
                  base={m.sent}
                  className="bg-indigo-500"
                />
                <FunnelRow
                  label="Lidas"
                  value={readCount}
                  base={m.sent}
                  className="bg-emerald-500"
                />
                {ack && ack.failed > 0 && (
                  <FunnelRow
                    label="Falhas"
                    value={ack.failed}
                    base={m.sent}
                    className="bg-red-500"
                  />
                )}
                <p className="pt-1 text-xs text-muted-foreground">
                  Total no histórico: {fmt(m.total)} mensagens ({fmt(m.sent)} enviadas ·{' '}
                  {fmt(m.received)} recebidas).
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Carregando métricas…</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Mensagens — últimos 14 dias</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <DailyBars data={m?.perDay ?? []} />
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-primary" /> enviadas
              </span>
              <span className="flex items-center gap-1.5">
                <span className="size-2 rounded-sm bg-sky-400" /> recebidas
              </span>
              {m && (
                <span className="ml-auto">7 dias: {fmt(m.last7d.sent + m.last7d.received)}</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Engines + Status/atenção */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Instâncias por engine</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {perEngine.map((e) => {
              const p = total ? Math.round((e.count / total) * 100) : 0;
              return (
                <div key={e.value} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {e.label}
                      {e.official && <span className="ml-2 text-xs text-primary">oficial</span>}
                    </span>
                    <span className="text-muted-foreground">{e.count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div className="h-full rounded-full bg-primary" style={{ width: `${p}%` }} />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Status &amp; atenção</span>
              {attention.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-amber-500">
                  <AlertTriangle className="size-3.5" /> {attention.length} precisa(m) de atenção
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {Object.entries(byStatus).map(([s, n]) => (
                <span
                  key={s}
                  className="rounded-full border bg-muted/50 px-2.5 py-1 text-xs font-medium"
                >
                  {STATUS_LABEL[s] ?? s}: {n}
                </span>
              ))}
              {total === 0 && (
                <span className="text-sm text-muted-foreground">Nenhuma instância ainda.</span>
              )}
            </div>

            {attention.length > 0 && (
              <div className="space-y-1 border-t pt-3">
                {attention.slice(0, 6).map((i) => (
                  <div key={i.id} className="flex items-center justify-between text-sm">
                    <span className="truncate font-medium">{i.name}</span>
                    <span className="ml-2 shrink-0 text-xs text-amber-500">
                      {STATUS_LABEL[statusOf(i)] ?? statusOf(i)} · {i.provider}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t pt-3 text-xs text-muted-foreground">
              Eventos ligados — Webhook: {events.webhook} · WebSocket: {events.websocket} ·
              RabbitMQ: {events.rabbitmq}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
