import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { CreateInstanceBody, PROVIDERS, Provider, useCreateInstance } from '../api';
import { Button, Field, Input, Modal, Select } from '../ui';

/** Campos de configuração conhecidos por engine — formulário amigável em vez de JSON cru. */
type ConfigField = { key: string; label: string; placeholder?: string; hint?: string };

const PROVIDER_CONFIG: Record<Provider, ConfigField[]> = {
  baileys: [
    {
      key: 'deviceClient',
      label: 'Nome do dispositivo',
      placeholder: 'WAMux',
      hint: 'Como aparece em "Aparelhos conectados". Opcional.',
    },
    { key: 'deviceBrowser', label: 'Navegador', placeholder: 'Chrome', hint: 'Opcional.' },
    {
      key: 'proxyUrl',
      label: 'Proxy URL',
      placeholder: 'socks5://user:senha@host:porta',
      hint: 'Opcional — http/https/socks. Anti-ban / geo.',
    },
  ],
  webjs: [
    {
      key: 'proxyUrl',
      label: 'Proxy URL',
      placeholder: 'http://host:porta',
      hint: 'Opcional — sem user:senha (limitação do Chrome).',
    },
  ],
  cloud: [
    { key: 'phoneNumberId', label: 'Phone Number ID', placeholder: '123456789012345' },
    { key: 'accessToken', label: 'Access Token', placeholder: 'EAAG...' },
    { key: 'wabaId', label: 'WABA ID', hint: 'Opcional — ID da conta WhatsApp Business.' },
  ],
  whatsmeow: [
    { key: 'companyName', label: 'Nome da empresa', hint: 'Opcional.' },
    { key: 'sideName', label: 'Nome exibido', hint: 'Opcional.' },
    { key: 'phoneNumber', label: 'Número de telefone', placeholder: '5511999999999', hint: 'Opcional.' },
    { key: 'proxyUrl', label: 'Proxy URL', placeholder: 'http://user:senha@host:porta', hint: 'Opcional.' },
  ],
};

export function CreateInstanceModal({ onClose }: { onClose: () => void }) {
  const create = useCreateInstance();
  const [name, setName] = useState('');
  const [provider, setProvider] = useState<Provider>('baileys');
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [advancedJson, setAdvancedJson] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [err, setErr] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const fields = PROVIDER_CONFIG[provider] ?? [];

  const changeProvider = (p: Provider) => {
    setProvider(p);
    setCfg({});
    setErr('');
  };

  const setField = (key: string, value: string) => setCfg((c) => ({ ...c, [key]: value }));

  /** Monta o objeto de config a partir dos campos + JSON avançado. `'invalid'` = JSON quebrado. */
  const buildConfig = (): Record<string, unknown> | null | 'invalid' => {
    const obj: Record<string, unknown> = {};
    for (const f of fields) {
      const v = cfg[f.key]?.trim();
      if (v) obj[f.key] = v;
    }
    if (advancedJson.trim()) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(advancedJson);
      } catch {
        return 'invalid';
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'invalid';
      Object.assign(obj, parsed);
    }
    return Object.keys(obj).length ? obj : null;
  };

  const submit = () => {
    setErr('');
    const body: CreateInstanceBody = { name: name.trim(), provider };
    const built = buildConfig();
    if (built === 'invalid') {
      setErr('A configuração avançada não é um JSON válido.');
      return;
    }
    if (built) body.config = built;
    if (webhookUrl.trim()) body.webhookUrl = webhookUrl.trim();
    create.mutate(body, {
      onSuccess: (inst) => setCreatedKey(inst.apiKey ?? ''),
      onError: (e) => setErr((e as Error).message),
    });
  };

  if (createdKey !== null) {
    return (
      <Modal title="Instância criada" onClose={onClose}>
        <p className="text-sm text-muted-foreground">
          Guarde a <b className="text-foreground">API key da instância</b> — ela só aparece agora:
        </p>
        <div className="flex items-center gap-2 rounded-lg border bg-muted p-2">
          <code className="flex-1 truncate text-xs text-primary">{createdKey}</code>
          <Button
            variant="ghost"
            onClick={() => {
              navigator.clipboard.writeText(createdKey);
              setCopied(true);
            }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          </Button>
        </div>
        <Button className="w-full" onClick={onClose}>
          Concluir
        </Button>
      </Modal>
    );
  }

  return (
    <Modal title="Nova instância" onClose={onClose}>
      <Field label="Nome">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="vendas-01" autoFocus />
      </Field>
      <Field label="Engine">
        <Select value={provider} onChange={(e) => changeProvider(e.target.value as Provider)}>
          {PROVIDERS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label} {p.official ? '· oficial' : ''}
            </option>
          ))}
        </Select>
      </Field>

      {/* Configuração da engine — campos guiados em vez de JSON cru */}
      <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Configuração da engine
        </span>
        {fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Esta engine não precisa de configuração. Crie a instância e conecte pelo QR Code.
          </p>
        ) : (
          fields.map((f) => (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <Input
                value={cfg[f.key] ?? ''}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
              />
            </Field>
          ))
        )}

        <details className="group">
          <summary className="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">
            Configuração avançada (JSON)
          </summary>
          <textarea
            value={advancedJson}
            onChange={(e) => setAdvancedJson(e.target.value)}
            placeholder='{ "chave": "valor" }'
            rows={3}
            spellCheck={false}
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <span className="mt-1 block text-xs text-muted-foreground">
            Opcional. Sobrescreve os campos acima e permite chaves extras.
          </span>
        </details>
      </div>

      <Field label="Webhook URL (opcional)">
        <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://meu-app.com/webhook" />
      </Field>
      {err && <p className="text-xs text-destructive">{err}</p>}
      <Button className="w-full" loading={create.isPending} disabled={!name.trim()} onClick={submit}>
        Criar
      </Button>
    </Modal>
  );
}
