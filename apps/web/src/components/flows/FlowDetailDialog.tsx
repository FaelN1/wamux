import { useState } from 'react';
import { CopyPlus, Download, ExternalLink, Lock, Save, Send, WandSparkles } from 'lucide-react';
import {
  useFlow,
  useFlowAssets,
  useFlowJsonDownload,
  useUpdateFlowJson,
  useUpdateFlowMetadata,
  type Flow,
} from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  ErrorNote,
  FLOW_CATEGORY_LABEL,
  FlowStatusBadge,
  HealthBadge,
  JsonBlock,
  ValidationErrors,
  formatDate,
  isRecord,
  jsonSyntaxError,
  prettyJson,
  textareaCls,
} from './flow-ui';

interface Props {
  instanceId: string;
  flowId: string;
  /** URL do gateway desta instância, oferecida como atalho para o endpoint_uri. */
  gatewayEndpointUri?: string | null;
  onClose: () => void;
  onClone: (flow: Flow) => void;
  onSend: (flow: Flow) => void;
}

export function FlowDetailDialog(p: Props) {
  const flow = useFlow(p.instanceId, p.flowId);
  // sinalizado pelo editor para pedir confirmação antes de descartar o texto.
  const [unsaved, setUnsaved] = useState(false);

  // sair do diálogo (fechar, clonar, enviar teste) descarta o texto do editor.
  const leave = (then: () => void) => {
    if (unsaved && !confirm('Há alterações no Flow JSON que não foram salvas. Descartar?')) return;
    then();
  };
  const close = () => leave(p.onClose);

  const f = flow.data;
  const editable = f?.status === 'DRAFT';

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="break-all">{f?.name ?? 'Flow'}</span>
            {f && <FlowStatusBadge status={f.status} />}
          </DialogTitle>
          <DialogDescription className="break-all">
            ID <code>{p.flowId}</code>
          </DialogDescription>
        </DialogHeader>

        {flow.isLoading && (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        )}
        {flow.isError && (
          <div className="space-y-2">
            <ErrorNote error={flow.error} />
            <Button variant="outline" size="sm" onClick={() => flow.refetch()}>
              Tentar de novo
            </Button>
          </div>
        )}

        {f && (
          <div className="space-y-5">
            {f.categories?.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {f.categories.map((c) => (
                  <Badge key={c} variant="outline">
                    {FLOW_CATEGORY_LABEL[c] ?? c}
                  </Badge>
                ))}
              </div>
            )}

            {!editable && (
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
                <Lock className="size-4 shrink-0 text-amber-500" />
                <p className="min-w-0 flex-1">
                  Somente leitura: Flows fora de <b>DRAFT</b> são imutáveis. Para alterar, clone
                  este Flow e publique o clone.
                </p>
                <Button variant="outline" size="sm" onClick={() => leave(() => p.onClone(f))}>
                  <CopyPlus /> Clonar
                </Button>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <Fact label="Flow JSON (json_version)" value={f.json_version} />
              <Fact label="Data API (data_api_version)" value={f.data_api_version} />
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Prévia</p>
                {f.preview?.preview_url ? (
                  <>
                    <a
                      href={f.preview.preview_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
                    >
                      Abrir prévia <ExternalLink className="size-3.5" />
                    </a>
                    {f.preview.expires_at && (
                      <p className="text-xs text-muted-foreground">
                        expira em {formatDate(f.preview.expires_at)}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-sm">—</p>
                )}
              </div>
            </div>

            <EndpointUriField
              instanceId={p.instanceId}
              flow={f}
              editable={editable}
              gatewayEndpointUri={p.gatewayEndpointUri}
            />

            <HealthStatus value={f.health_status} />

            <FlowJsonEditor
              instanceId={p.instanceId}
              flow={f}
              editable={editable}
              onUnsavedChange={setUnsaved}
            />

            <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => leave(() => p.onSend(f))}>
                <Send /> Enviar teste
              </Button>
              <Button variant="outline" onClick={close}>
                Fechar
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-mono text-sm">{value || '—'}</p>
    </div>
  );
}

// ── endpoint_uri (PATCH, só DRAFT) ───────────────────────

function EndpointUriField({
  instanceId,
  flow,
  editable,
  gatewayEndpointUri,
}: {
  instanceId: string;
  flow: Flow;
  editable: boolean;
  gatewayEndpointUri?: string | null;
}) {
  const update = useUpdateFlowMetadata(instanceId);
  // null = ainda não editado → mostra o valor vindo da API.
  const [draft, setDraft] = useState<string | null>(null);
  const current = flow.endpoint_uri ?? '';
  const value = draft ?? current;
  const changed = value.trim() !== current;

  const save = () =>
    update.mutate(
      { flowId: flow.id, patch: { endpoint_uri: value.trim() } },
      { onSuccess: () => setDraft(null) },
    );

  return (
    <div className="space-y-1.5">
      <Label htmlFor="fd-endpoint-uri">endpoint_uri</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="fd-endpoint-uri"
          value={value}
          disabled={!editable}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={editable ? 'https://…/api/webhooks/flows/…' : 'sem endpoint (Flow estático)'}
          className="min-w-0 flex-1 basis-60"
        />
        {editable && (
          <Button
            variant="outline"
            onClick={save}
            disabled={!changed || !value.trim() || update.isPending}
          >
            <Save /> {update.isPending ? 'Salvando…' : 'Salvar'}
          </Button>
        )}
      </div>
      {editable && gatewayEndpointUri && value !== gatewayEndpointUri && (
        <button
          type="button"
          className="text-xs text-primary underline-offset-4 hover:underline"
          onClick={() => setDraft(gatewayEndpointUri)}
        >
          Usar o endpoint deste gateway
        </button>
      )}
      {update.isSuccess && !changed && (
        <p className="text-xs text-emerald-500">endpoint_uri atualizado.</p>
      )}
      <ErrorNote error={update.error} />
    </div>
  );
}

// ── health_status ────────────────────────────────────────

/**
 * `health_status` vem da Meta sem contrato fixo: mostra o que for reconhecível
 * (`can_send_message` e a lista de `entities`) e deixa o objeto cru à mão.
 */
function HealthStatus({ value }: { value: unknown }) {
  if (value == null) return null;
  const root = isRecord(value) ? value : undefined;
  const overall = typeof root?.can_send_message === 'string' ? root.can_send_message : undefined;
  const entities = Array.isArray(root?.entities) ? root.entities.filter(isRecord) : [];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label>Saúde (health_status)</Label>
        {overall && <HealthBadge value={overall} />}
      </div>
      {entities.length > 0 && (
        <ul className="space-y-1.5">
          {entities.map((e, i) => (
            <li key={i} className="space-y-1 rounded-md border p-2 text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium">
                  {typeof e.entity_type === 'string' ? e.entity_type : `entidade ${i + 1}`}
                </span>
                {typeof e.can_send_message === 'string' && (
                  <HealthBadge value={e.can_send_message} />
                )}
              </div>
              {Array.isArray(e.errors) &&
                e.errors.filter(isRecord).map((err, j) => (
                  <p key={j} className="break-words text-destructive">
                    {typeof err.error_description === 'string'
                      ? err.error_description
                      : JSON.stringify(err)}
                    {typeof err.possible_solution === 'string' && (
                      <span className="text-muted-foreground"> — {err.possible_solution}</span>
                    )}
                  </p>
                ))}
            </li>
          ))}
        </ul>
      )}
      <details>
        <summary className="cursor-pointer text-xs text-muted-foreground">
          Ver JSON completo
        </summary>
        <JsonBlock value={value} className="mt-2" />
      </details>
    </div>
  );
}

// ── editor do Flow JSON ──────────────────────────────────

function FlowJsonEditor({
  instanceId,
  flow,
  editable,
  onUnsavedChange,
}: {
  instanceId: string;
  flow: Flow;
  editable: boolean;
  onUnsavedChange: (unsaved: boolean) => void;
}) {
  const assets = useFlowAssets(instanceId, flow.id);
  const asset =
    assets.data?.find((a) => a.asset_type === 'FLOW_JSON' && a.download_url) ??
    assets.data?.find((a) => a.download_url);
  const download = useFlowJsonDownload(instanceId, flow.id);
  const save = useUpdateFlowJson(instanceId);

  // null = ainda não editado → mostra o JSON baixado (ou vazio, se o download falhou).
  const [draft, setDraft] = useState<string | null>(null);
  const loaded = download.data ? prettyJson(download.data) : '';
  const text = draft ?? loaded;

  const edit = (next: string) => {
    setDraft(next);
    onUnsavedChange(next !== loaded);
  };

  const loadingJson = download.isLoading;
  const syntaxError = text.trim() ? jsonSyntaxError(text) : null;
  const canSave = editable && !!text.trim() && !syntaxError && !save.isPending;

  const submit = () => {
    if (!canSave) return;
    save.mutate({ flowId: flow.id, flowJson: text }, { onSuccess: () => onUnsavedChange(false) });
  };

  // erros do último save têm prioridade; sem save, os que vieram no detalhe.
  const validation = save.data?.validation_errors ?? flow.validation_errors;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor="fd-json">Flow JSON</Label>
        <div className="flex flex-wrap items-center gap-2">
          {asset?.download_url && (
            <a
              href={asset.download_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary underline-offset-4 hover:underline"
            >
              <Download className="size-3.5" /> Baixar {asset.name || 'flow.json'}
            </a>
          )}
          {editable && (
            <Button
              variant="ghost"
              size="sm"
              disabled={!text.trim() || !!syntaxError}
              onClick={() => edit(prettyJson(text))}
            >
              <WandSparkles /> Formatar
            </Button>
          )}
        </div>
      </div>

      {assets.isError && (
        <p className="text-xs text-amber-500">
          Não foi possível listar os assets do Flow: {(assets.error as Error).message}
        </p>
      )}
      {download.isError && (
        <p className="text-xs text-amber-500">
          Não foi possível carregar o JSON vigente pelo gateway ({download.error.message}). Use
          «Baixar» acima
          {editable ? ' e cole o conteúdo no editor para alterá-lo.' : ' para consultá-lo.'}
        </p>
      )}
      {assets.isSuccess && !asset && (
        <p className="text-xs text-muted-foreground">Este Flow ainda não tem um Flow JSON.</p>
      )}

      {loadingJson ? (
        <Skeleton className="h-72 w-full" />
      ) : (
        <textarea
          id="fd-json"
          value={text}
          readOnly={!editable}
          onChange={(e) => edit(e.target.value)}
          rows={18}
          spellCheck={false}
          wrap="off"
          className={cn(
            textareaCls,
            'font-mono text-xs leading-relaxed',
            !editable && 'cursor-default bg-muted/40',
          )}
          placeholder={
            editable ? '{\n  "version": "7.3",\n  "screens": []\n}' : 'JSON não carregado.'
          }
        />
      )}

      {syntaxError && <p className="text-xs text-destructive">JSON inválido: {syntaxError}</p>}

      {editable && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={submit} disabled={canSave === false}>
            <Save /> {save.isPending ? 'Salvando…' : 'Salvar Flow JSON'}
          </Button>
          {save.isSuccess && (
            <span className="text-xs text-muted-foreground">
              Salvo — a Meta validou o JSON, veja abaixo.
            </span>
          )}
        </div>
      )}
      <ErrorNote error={save.error} />
      <ValidationErrors errors={validation} />
    </div>
  );
}
