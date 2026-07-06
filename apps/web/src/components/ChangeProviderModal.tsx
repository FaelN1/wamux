import { useState } from 'react';
import { ArrowLeftRight, CheckCircle2, X } from 'lucide-react';
import { PROVIDERS } from '@wamux/shared';
import { Instance, Provider, useChangeProvider } from '@/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function ChangeProviderModal({
  instance,
  onClose,
}: {
  instance: Instance;
  onClose: () => void;
}) {
  const change = useChangeProvider();
  const others = PROVIDERS.filter((p) => p.value !== instance.provider);
  const [provider, setProvider] = useState<Provider>(others[0]?.value ?? instance.provider);
  const [migrate, setMigrate] = useState(false);

  const currentLabel = PROVIDERS.find((p) => p.value === instance.provider)?.label ?? instance.provider;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border bg-card text-card-foreground shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="font-display text-sm font-semibold">Trocar engine — {instance.name}</h2>
          <button onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-accent">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div className="space-y-1.5">
            <Label>Engine atual</Label>
            <p className="text-sm text-muted-foreground">{currentLabel}</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="cp-target">Nova engine</Label>
            <select
              id="cp-target"
              value={provider}
              onChange={(e) => setProvider(e.target.value as Provider)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
            >
              {others.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div>
              <Label htmlFor="cp-migrate">Migrar sem reparear</Label>
              <p className="text-xs text-muted-foreground">
                Experimental — reaproveita as credenciais (só Baileys ⇄ whatsmeow). Senão, gera QR novo.
              </p>
            </div>
            <Switch id="cp-migrate" checked={migrate} onCheckedChange={setMigrate} />
          </div>

          {change.data && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/10 p-3 text-sm">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
              <span>{change.data.message}</span>
            </div>
          )}
          {change.isError && (
            <p className="text-sm text-destructive">{(change.error as Error).message}</p>
          )}

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={onClose}>
              Fechar
            </Button>
            <Button
              className="flex-1"
              disabled={change.isPending}
              onClick={() => change.mutate({ id: instance.id, provider, migrate })}
            >
              <ArrowLeftRight /> Trocar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
