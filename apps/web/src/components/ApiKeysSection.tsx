import { useState } from 'react';
import { Bot, Check, Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import {
  ApiKeyAction,
  Instance,
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  type ApiKeySummary,
  type CreateApiKeyResult,
} from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

const ACTION_LABEL: Record<ApiKeyAction, string> = {
  [ApiKeyAction.READ]: 'Leitura',
  [ApiKeyAction.SEND]: 'Enviar mensagens',
  [ApiKeyAction.CONTROL]: 'Controle (conectar/QR/logout)',
  [ApiKeyAction.SETTING]: 'Configuração',
  [ApiKeyAction.APP]: 'Gerenciar keys/apps',
  [ApiKeyAction.DELETE]: 'Ações destrutivas',
};

const ALL_ACTIONS = Object.values(ApiKeyAction);

function ActionBadges({ actions }: { actions: ApiKeyAction[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {actions.map((a) => (
        <span
          key={a}
          className="rounded-full border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
        >
          {a}
        </span>
      ))}
    </div>
  );
}

function KeyRow({
  item,
  onRevoke,
  revoking,
}: {
  item: ApiKeySummary;
  onRevoke: () => void;
  revoking: boolean;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <div
      className={cn(
        'flex items-center justify-between gap-3 rounded-lg border p-3',
        item.revoked && 'opacity-50',
      )}
    >
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          {item.kind === 'mcp' ? (
            <Bot className="size-4 shrink-0 text-primary" />
          ) : (
            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate text-sm font-medium">{item.label}</span>
          <code className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {item.keyPrefix}…
          </code>
          {item.revoked && (
            <span className="shrink-0 rounded-full bg-destructive/10 px-2 py-0.5 text-[10px] font-medium text-destructive">
              revogada
            </span>
          )}
        </div>
        <ActionBadges actions={item.actions} />
        <p className="text-xs text-muted-foreground">
          Criada em {new Date(item.createdAt).toLocaleDateString('pt-BR')}
          {item.lastUsedAt &&
            ` · último uso em ${new Date(item.lastUsedAt).toLocaleString('pt-BR')}`}
        </p>
      </div>
      {!item.revoked && (
        <Button
          variant={confirming ? 'destructive' : 'outline'}
          size="sm"
          disabled={revoking}
          onClick={() => (confirming ? onRevoke() : setConfirming(true))}
          onBlur={() => setConfirming(false)}
        >
          <Trash2 className="size-4" /> {confirming ? 'Confirmar?' : 'Revogar'}
        </Button>
      )}
    </div>
  );
}

function CreateKeyForm({ instanceId }: { instanceId: string }) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'generic' | 'mcp'>('generic');
  const [actions, setActions] = useState<ApiKeyAction[]>([]);
  const [justCreated, setJustCreated] = useState<CreateApiKeyResult | null>(null);
  const [copied, setCopied] = useState(false);
  const create = useCreateApiKey(instanceId);

  const toggle = (a: ApiKeyAction) =>
    setActions((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  const submit = () => {
    if (!label.trim() || actions.length === 0) return;
    create.mutate(
      { label: label.trim(), actions, kind },
      {
        onSuccess: (result) => {
          setJustCreated(result);
          setLabel('');
          setActions([]);
          setKind('generic');
        },
      },
    );
  };

  const copyKey = () => {
    if (!justCreated) return;
    void navigator.clipboard.writeText(justCreated.key);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (justCreated) {
    return (
      <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
        <p className="text-sm font-medium">
          Key criada — <b>copie agora</b>, ela não aparece de novo.
        </p>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded bg-background px-2 py-1.5 text-xs">
            {justCreated.key}
          </code>
          <Button variant="outline" size="sm" onClick={copyKey}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? 'Copiado' : 'Copiar'}
          </Button>
        </div>
        <Button variant="ghost" size="sm" onClick={() => setJustCreated(null)}>
          Criar outra
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="space-y-1.5">
          <Label htmlFor="key-label">Rótulo</Label>
          <Input
            id="key-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ex.: bot n8n, agente Claude…"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Tipo</Label>
          <Select value={kind} onValueChange={(v) => setKind(v as 'generic' | 'mcp')}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="generic">Genérica</SelectItem>
              <SelectItem value="mcp">App MCP</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Ações permitidas</Label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ALL_ACTIONS.map((a) => {
            const checked = actions.includes(a);
            return (
              <button
                key={a}
                type="button"
                onClick={() => toggle(a)}
                className={cn(
                  'flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors',
                  checked ? 'border-primary bg-primary/10' : 'hover:bg-accent/50',
                )}
              >
                <span
                  className={cn(
                    'flex size-4 shrink-0 items-center justify-center rounded border',
                    checked ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
                  )}
                >
                  {checked && <Check className="size-3" />}
                </span>
                {ACTION_LABEL[a]}
              </button>
            );
          })}
        </div>
        {kind === 'mcp' && !actions.includes(ApiKeyAction.APP) && (
          <p className="text-xs text-amber-500">
            Apps MCP precisam da ação "Gerenciar keys/apps" pra abrir sessão em <code>/mcp</code>.
          </p>
        )}
      </div>

      {create.isError && (
        <p className="text-xs text-destructive">{(create.error as Error).message}</p>
      )}

      <Button onClick={submit} disabled={create.isPending || !label.trim() || actions.length === 0}>
        <Plus className="size-4" /> Criar key
      </Button>
    </div>
  );
}

/**
 * Gestão de API keys escopadas + apps MCP — mesmo espírito de UI das
 * outras seções do drawer (webhook/websocket/rabbitmq). "App MCP" é só uma
 * key com `kind: 'mcp'`, sem entidade própria (ver `docs/api-keys-mcp-handoff.md`).
 */
export function ApiKeysSection({ instance }: { instance: Instance }) {
  const { data: keys, isLoading } = useApiKeys(instance.id);
  const revoke = useRevokeApiKey(instance.id);

  const active = (keys ?? []).filter((k) => !k.revoked);
  const revoked = (keys ?? []).filter((k) => k.revoked);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">API keys & apps MCP</h3>
        <p className="text-xs text-muted-foreground">
          A key mestra da instância continua com acesso total. Keys criadas aqui têm só as ações
          marcadas — uma key não pode conceder uma ação que ela mesma não tem.
        </p>
      </div>

      <CreateKeyForm instanceId={instance.id} />

      <div className="space-y-2">
        {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
        {!isLoading && active.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhuma key escopada ainda.</p>
        )}
        {active.map((k) => (
          <KeyRow
            key={k.id}
            item={k}
            revoking={revoke.isPending}
            onRevoke={() => revoke.mutate(k.id)}
          />
        ))}
        {revoked.length > 0 && (
          <details className="pt-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">
              {revoked.length} revogada(s)
            </summary>
            <div className="mt-2 space-y-2">
              {revoked.map((k) => (
                <KeyRow key={k.id} item={k} revoking={false} onRevoke={() => {}} />
              ))}
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
