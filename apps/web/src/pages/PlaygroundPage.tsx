import { useMemo, useState } from 'react';
import { Check, Copy, Play, Terminal } from 'lucide-react';
import { rawRequest, useInstances, type RawResult } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

// Presets cobrindo a superfície (docs 03–15). {id} é trocado pela instância.
type Preset = { group: string; label: string; method: string; path: string; body?: string };
const PRESETS: Preset[] = [
  { group: 'Sistema', label: 'Health', method: 'GET', path: '/health' },
  { group: 'Sistema', label: 'GET settings', method: 'GET', path: '/settings' },
  { group: 'Instâncias', label: 'Listar', method: 'GET', path: '/instances' },
  { group: 'Instâncias', label: 'Criar', method: 'POST', path: '/instances', body: '{\n  "name": "teste-01",\n  "provider": "baileys"\n}' },
  { group: 'Instâncias', label: 'Detalhe', method: 'GET', path: '/instances/{id}' },
  { group: 'Instâncias', label: 'Conectar', method: 'POST', path: '/instances/{id}/connect' },
  { group: 'Instâncias', label: 'QR', method: 'GET', path: '/instances/{id}/qr' },
  { group: 'Instâncias', label: 'Pair code', method: 'POST', path: '/instances/{id}/pair-code', body: '{ "phone": "5511999999999" }' },
  { group: 'Instâncias', label: 'Capabilities', method: 'GET', path: '/instances/{id}/capabilities' },
  { group: 'Instâncias', label: 'Eventos', method: 'PUT', path: '/instances/{id}/events', body: '{\n  "webhook": { "enabled": true, "url": "https://exemplo.com/hook", "events": [] },\n  "websocket": { "enabled": false, "events": [] },\n  "rabbitmq": { "enabled": false, "events": [] }\n}' },
  { group: 'Instâncias', label: 'Filtros JID', method: 'PUT', path: '/instances/{id}/filters', body: '{ "allowJids": [], "blockJids": ["5511888888888"], "direction": "both" }' },
  { group: 'Instâncias', label: 'Anti-ban', method: 'PUT', path: '/instances/{id}/anti-ban', body: '{ "profile": "normal" }' },
  { group: 'Instâncias', label: 'Anti-ban status', method: 'GET', path: '/instances/{id}/anti-ban/status' },
  { group: 'Mensagens', label: 'Texto', method: 'POST', path: '/messages/{id}/text', body: '{ "to": "5511999999999", "text": "Olá do WAMux! 🚀" }' },
  { group: 'Mensagens', label: 'Mídia', method: 'POST', path: '/messages/{id}/media', body: '{ "to": "5511999999999", "type": "image", "url": "https://picsum.photos/400", "caption": "teste" }' },
  { group: 'Mensagens', label: 'Enquete', method: 'POST', path: '/messages/{id}/poll', body: '{ "to": "5511999999999", "question": "Cor?", "options": ["Azul","Verde"] }' },
  { group: 'Mensagens', label: 'Botões', method: 'POST', path: '/messages/{id}/buttons', body: '{ "to": "5511999999999", "text": "Escolha", "buttons": [{ "type": "reply", "id": "a", "title": "A" }], "fallbackToText": true }' },
  { group: 'Mensagens', label: 'Status', method: 'GET', path: '/messages/{id}/status/{messageId}' },
  { group: 'Etiquetas', label: 'Listar', method: 'GET', path: '/instances/{id}/labels' },
  { group: 'Contatos', label: 'Checar números', method: 'POST', path: '/instances/{id}/numbers/check', body: '{ "numbers": ["5511999999999"] }' },
  { group: 'Contatos', label: 'Presença', method: 'POST', path: '/instances/{id}/presence', body: '{ "to": "5511999999999", "state": "composing", "durationMs": 2000 }' },
  { group: 'Canais', label: 'Listar', method: 'GET', path: '/instances/{id}/newsletters' },
  { group: 'Identidade', label: 'Resolver', method: 'GET', path: '/instances/{id}/identity/resolve?phone=5511999999999' },
  { group: 'Histórico', label: 'Importar', method: 'POST', path: '/instances/{id}/history/import', body: '{ "from": "2024-01-01T00:00:00Z", "deliverToWebhook": false }' },
  { group: 'Webhook', label: 'DLQ', method: 'GET', path: '/instances/{id}/webhook/dlq' },
];

const STATUS_COLOR = (s: number) =>
  s === 0 ? 'text-muted-foreground' : s < 300 ? 'text-emerald-500' : s < 400 ? 'text-amber-500' : 'text-red-500';

export function PlaygroundPage() {
  const { data: instances } = useInstances();
  const [instanceId, setInstanceId] = useState('');
  const [apiKeyOverride, setApiKeyOverride] = useState('');
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/health');
  const [bodyText, setBodyText] = useState('');
  const [result, setResult] = useState<RawResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [history, setHistory] = useState<{ method: string; path: string; status: number; ms: number }[]>([]);

  const grouped = useMemo(() => {
    const g: Record<string, Preset[]> = {};
    for (const p of PRESETS) (g[p.group] ??= []).push(p);
    return g;
  }, []);

  const bodyInvalid = useMemo(() => {
    if (!bodyText.trim() || method === 'GET') return false;
    try {
      JSON.parse(bodyText);
      return false;
    } catch {
      return true;
    }
  }, [bodyText, method]);

  const realPath = () => path.replace('{id}', instanceId || '{id}');

  const applyPreset = (p: Preset) => {
    setMethod(p.method);
    setPath(p.path);
    setBodyText(p.body ?? '');
    setResult(null);
  };

  const send = async () => {
    setLoading(true);
    const res = await rawRequest(method, realPath(), bodyText, apiKeyOverride);
    setResult(res);
    setHistory((h) => [{ method, path: realPath(), status: res.status, ms: res.ms }, ...h].slice(0, 15));
    setLoading(false);
  };

  const curl = () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const key = apiKeyOverride.trim() || 'SUA_API_KEY';
    let c = `curl -X ${method} '${origin}/api/v1${realPath()}' -H 'apikey: ${key}'`;
    if (bodyText.trim() && method !== 'GET') {
      c += ` -H 'Content-Type: application/json' -d '${bodyText.replace(/\n\s*/g, ' ')}'`;
    }
    return c;
  };

  const qrImage =
    result?.data && typeof result.data === 'object' && 'qrImage' in result.data
      ? (result.data as { qrImage?: string }).qrImage
      : undefined;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Builder */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Terminal className="size-4 text-primary" /> Requisição
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Instância</Label>
                <select
                  value={instanceId}
                  onChange={(e) => setInstanceId(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  <option value="">— selecione (injeta {'{id}'}) —</option>
                  {(instances ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name} ({i.provider})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>API key (override)</Label>
                <Input
                  value={apiKeyOverride}
                  onChange={(e) => setApiKeyOverride(e.target.value)}
                  placeholder="usa a global por padrão"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Presets</Label>
              <select
                onChange={(e) => {
                  const p = PRESETS[Number(e.target.value)];
                  if (p) applyPreset(p);
                }}
                value=""
                className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
              >
                <option value="">— escolha um preset —</option>
                {Object.entries(grouped).map(([g, ps]) => (
                  <optgroup key={g} label={g}>
                    {ps.map((p) => (
                      <option key={p.label} value={PRESETS.indexOf(p)}>
                        {p.method} {p.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div className="flex gap-2">
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="h-9 rounded-md border border-input bg-transparent px-2 text-sm font-medium"
              >
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
              <Input value={path} onChange={(e) => setPath(e.target.value)} className="flex-1 font-mono text-xs" />
            </div>

            <div className="space-y-1.5">
              <Label>Body (JSON)</Label>
              <textarea
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                rows={7}
                spellCheck={false}
                className={cn(
                  'w-full rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none',
                  bodyInvalid ? 'border-destructive' : 'border-input',
                )}
                placeholder={method === 'GET' ? '(GET não envia body)' : '{ }'}
              />
              {bodyInvalid && <p className="text-xs text-destructive">JSON inválido.</p>}
            </div>

            <div className="flex items-center gap-2">
              <Button onClick={send} disabled={loading || bodyInvalid}>
                <Play /> Enviar
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(curl());
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }}
              >
                {copied ? <Check /> : <Copy />} cURL
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Resposta */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between text-base">
              <span>Resposta</span>
              {result && (
                <span className="flex items-center gap-3 text-xs">
                  <span className={cn('font-mono font-semibold', STATUS_COLOR(result.status))}>
                    {result.status || 'ERR'} {result.statusText}
                  </span>
                  <span className="text-muted-foreground">{result.ms}ms</span>
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {qrImage && <img src={qrImage} alt="QR" className="mb-3 size-48 rounded border" />}
            <pre className="max-h-[420px] overflow-auto rounded-md bg-muted p-3 text-xs">
              {result
                ? result.error ?? JSON.stringify(result.data, null, 2)
                : 'Envie uma requisição para ver a resposta.'}
            </pre>
          </CardContent>
        </Card>
      </div>

      {/* Histórico */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Histórico da sessão</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {history.map((h, i) => (
              <div key={i} className="flex items-center gap-3 rounded px-2 py-1 text-xs hover:bg-accent/50">
                <span className="w-14 font-mono font-medium text-muted-foreground">{h.method}</span>
                <span className="flex-1 truncate font-mono">{h.path}</span>
                <span className={cn('font-mono', STATUS_COLOR(h.status))}>{h.status || 'ERR'}</span>
                <span className="text-muted-foreground">{h.ms}ms</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
