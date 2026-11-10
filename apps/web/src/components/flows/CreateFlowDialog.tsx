import { useState } from 'react';
import { Check, CopyPlus, Plus } from 'lucide-react';
import { useCreateFlow, type CreateFlowResult, type Flow, type FlowCategory } from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  ErrorNote,
  FLOW_CATEGORIES,
  FLOW_CATEGORY_LABEL,
  ValidationErrors,
  jsonSyntaxError,
  textareaCls,
} from './flow-ui';

interface Props {
  instanceId: string;
  /** quando presente, cria um clone (`clone_flow_id`) em vez de um Flow novo. */
  cloneFrom?: Flow;
  /** sugestão para o campo endpoint_uri (URL do gateway desta instância). */
  gatewayEndpointUri?: string | null;
  onClose: () => void;
  /** abre o editor do Flow recém-criado. */
  onOpenFlow: (flowId: string) => void;
}

export function CreateFlowDialog({
  instanceId,
  cloneFrom,
  gatewayEndpointUri,
  onClose,
  onOpenFlow,
}: Props) {
  const create = useCreateFlow(instanceId);
  const [name, setName] = useState(cloneFrom ? `${cloneFrom.name}_copia` : '');
  const [categories, setCategories] = useState<FlowCategory[]>(cloneFrom?.categories ?? []);
  const [flowJson, setFlowJson] = useState('');
  const [endpointUri, setEndpointUri] = useState(cloneFrom?.endpoint_uri ?? '');
  const [created, setCreated] = useState<CreateFlowResult | null>(null);

  const toggle = (c: FlowCategory) =>
    setCategories((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));

  const jsonError = flowJson.trim() ? jsonSyntaxError(flowJson) : null;
  const invalid = !name.trim() || categories.length === 0 || !!jsonError || create.isPending;

  const submit = () => {
    if (invalid) return;
    create.mutate(
      {
        name: name.trim(),
        categories,
        ...(cloneFrom ? { clone_flow_id: cloneFrom.id } : {}),
        ...(!cloneFrom && flowJson.trim() ? { flow_json: flowJson } : {}),
        ...(endpointUri.trim() ? { endpoint_uri: endpointUri.trim() } : {}),
      },
      { onSuccess: setCreated },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {cloneFrom ? (
              <CopyPlus className="size-4 text-primary" />
            ) : (
              <Plus className="size-4 text-primary" />
            )}
            {cloneFrom ? `Clonar «${cloneFrom.name}»` : 'Novo Flow'}
          </DialogTitle>
          <DialogDescription>
            {cloneFrom
              ? 'Cria um rascunho (DRAFT) com o mesmo Flow JSON. O original não é alterado.'
              : 'O Flow nasce como rascunho (DRAFT) e só pode ser enviado em produção depois de publicado.'}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="space-y-1 rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              <p className="font-medium">Flow criado.</p>
              <p className="text-xs text-muted-foreground">
                ID <code className="break-all">{created.id || '—'}</code>
              </p>
            </div>
            <ValidationErrors
              errors={created.validation_errors}
              okText="A Meta não apontou erros de validação."
            />
            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                Fechar
              </Button>
              {created.id && (
                <Button onClick={() => onOpenFlow(created.id)}>Abrir no editor</Button>
              )}
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="flow-name">Nome</Label>
              <Input
                id="flow-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="agendamento_consulta"
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label>Categorias (ao menos uma)</Label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {FLOW_CATEGORIES.map((c) => {
                  const checked = categories.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggle(c)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg border p-2 text-left text-xs transition-colors',
                        checked ? 'border-primary bg-primary/10' : 'hover:bg-accent/50',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border',
                          checked
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input',
                        )}
                      >
                        {checked && <Check className="size-3" />}
                      </span>
                      {FLOW_CATEGORY_LABEL[c]}
                    </button>
                  );
                })}
              </div>
            </div>

            {!cloneFrom && (
              <div className="space-y-1.5">
                <Label htmlFor="flow-json">Flow JSON (opcional)</Label>
                <textarea
                  id="flow-json"
                  value={flowJson}
                  onChange={(e) => setFlowJson(e.target.value)}
                  rows={8}
                  spellCheck={false}
                  className={cn(textareaCls, 'font-mono text-xs')}
                  placeholder={'{\n  "version": "7.3",\n  "screens": []\n}'}
                />
                {jsonError ? (
                  <p className="text-xs text-destructive">JSON inválido: {jsonError}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Pode ficar vazio e ser enviado depois, pelo editor.
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="flow-endpoint-uri">endpoint_uri (opcional)</Label>
              <Input
                id="flow-endpoint-uri"
                value={endpointUri}
                onChange={(e) => setEndpointUri(e.target.value)}
                placeholder="https://gateway.exemplo.com/api/webhooks/flows/…"
              />
              <p className="text-xs text-muted-foreground">
                Só para Flows com troca de dados. Vazio = Flow estático.
                {gatewayEndpointUri && endpointUri !== gatewayEndpointUri && (
                  <>
                    {' '}
                    <button
                      type="button"
                      className="text-primary underline-offset-4 hover:underline"
                      onClick={() => setEndpointUri(gatewayEndpointUri)}
                    >
                      Usar o endpoint deste gateway
                    </button>
                  </>
                )}
              </p>
            </div>

            <ErrorNote error={create.error} />
            <DialogFooter>
              <Button variant="outline" onClick={onClose} disabled={create.isPending}>
                Cancelar
              </Button>
              <Button onClick={submit} disabled={invalid}>
                {create.isPending ? 'Criando…' : cloneFrom ? 'Clonar' : 'Criar rascunho'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
