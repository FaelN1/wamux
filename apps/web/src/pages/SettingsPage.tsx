import { useEffect, useState } from 'react';
import { Check, KeyRound, Moon, Save, Sun } from 'lucide-react';
import type { WamuxSettings } from '@wamux/shared';
import { clearApiKey, useSettings, useUpdateSettings } from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

const THEME_KEY = 'wamux_theme';

function applyTheme(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
}

export function SettingsPage({ onLogout }: { onLogout: () => void }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const { data } = useSettings();
  const update = useUpdateSettings();
  const [form, setForm] = useState<WamuxSettings | null>(null);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next);
  };

  const patch = <S extends keyof WamuxSettings, K extends keyof WamuxSettings[S]>(
    section: S,
    key: K,
    value: WamuxSettings[S][K],
  ) => setForm((f) => (f ? { ...f, [section]: { ...f[section], [key]: value } } : f));

  return (
    <div className="space-y-6">
      {/* Aparência */}
      <Card>
        <CardHeader>
          <CardTitle>Aparência</CardTitle>
          <CardDescription>Tema do painel.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={toggleTheme}>
            {dark ? <Moon /> : <Sun />}
            {dark ? 'Tema escuro' : 'Tema claro'}
          </Button>
        </CardContent>
      </Card>

      {form && (
        <>
          {/* Webhook global */}
          <Card>
            <CardHeader>
              <CardTitle>Webhook global</CardTitle>
              <CardDescription>
                Aplicado às instâncias que <b>não</b> têm webhook próprio.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="wh-enabled">Habilitar webhook global</Label>
                <Switch
                  id="wh-enabled"
                  checked={form.webhookGlobal.enabled}
                  onCheckedChange={(v) => patch('webhookGlobal', 'enabled', v)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="wh-url">URL</Label>
                <Input
                  id="wh-url"
                  placeholder="https://meu-app.com/webhook"
                  value={form.webhookGlobal.url}
                  onChange={(e) => patch('webhookGlobal', 'url', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Rate limit */}
          <Card>
            <CardHeader>
              <CardTitle>Rate limit (anti-ban)</CardTitle>
              <CardDescription>Ritmo de envio por instância (token bucket).</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="rl-persec">Msgs por segundo</Label>
                <Input
                  id="rl-persec"
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={form.rateLimit.perSec}
                  onChange={(e) => patch('rateLimit', 'perSec', Number(e.target.value))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rl-burst">Rajada (burst)</Label>
                <Input
                  id="rl-burst"
                  type="number"
                  min="1"
                  value={form.rateLimit.burst}
                  onChange={(e) => patch('rateLimit', 'burst', Number(e.target.value))}
                />
              </div>
            </CardContent>
          </Card>

          {/* Dispositivo */}
          <Card>
            <CardHeader>
              <CardTitle>Identidade do dispositivo</CardTitle>
              <CardDescription>
                Como aparece no WhatsApp em “Aparelhos conectados” (Baileys). Vale no próximo connect.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="dv-client">Cliente</Label>
                <Input
                  id="dv-client"
                  value={form.device.client}
                  onChange={(e) => patch('device', 'client', e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="dv-browser">Navegador</Label>
                <Input
                  id="dv-browser"
                  value={form.device.browser}
                  onChange={(e) => patch('device', 'browser', e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={() => update.mutate(form)} disabled={update.isPending}>
              <Save /> Salvar configurações
            </Button>
            {update.isSuccess && (
              <span className="flex items-center gap-1 text-sm text-primary">
                <Check className="size-4" /> Salvo
              </span>
            )}
            {update.isError && (
              <span className="text-sm text-destructive">{(update.error as Error).message}</span>
            )}
          </div>
        </>
      )}

      {/* Autenticação */}
      <Card>
        <CardHeader>
          <CardTitle>Autenticação</CardTitle>
          <CardDescription>
            O painel usa a <b>GLOBAL_API_KEY</b> guardada no navegador para falar com o gateway.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            variant="destructive"
            onClick={() => {
              clearApiKey();
              onLogout();
            }}
          >
            <KeyRound /> Trocar API key
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
