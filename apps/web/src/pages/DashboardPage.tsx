import { Boxes, Layers, PlugZap, QrCode } from 'lucide-react';
import { PROVIDERS } from '@wamux/shared';
import { useInstances } from '@/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: typeof Boxes;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

export function DashboardPage() {
  const { data: instances } = useInstances();
  const list = instances ?? [];

  const statusOf = (i: (typeof list)[number]) => i.liveStatus ?? i.status;
  const total = list.length;
  const connected = list.filter((i) => statusOf(i) === 'connected').length;
  const awaitingQr = list.filter((i) => statusOf(i) === 'qr').length;
  const enginesUsed = new Set(list.map((i) => i.provider)).size;

  const perEngine = PROVIDERS.map((p) => ({
    ...p,
    count: list.filter((i) => i.provider === p.value).length,
  }));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Instâncias" value={total} icon={Boxes} />
        <StatCard label="Conectadas" value={connected} icon={PlugZap} />
        <StatCard label="Aguardando QR" value={awaitingQr} icon={QrCode} />
        <StatCard label="Engines em uso" value={enginesUsed} icon={Layers} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Instâncias por engine</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {perEngine.map((e) => {
            const pct = total ? Math.round((e.count / total) * 100) : 0;
            return (
              <div key={e.value} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    {e.label}
                    {e.official && (
                      <span className="ml-2 text-xs text-primary">oficial</span>
                    )}
                  </span>
                  <span className="text-muted-foreground">{e.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
