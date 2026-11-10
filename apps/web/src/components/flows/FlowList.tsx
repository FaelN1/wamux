import { useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CopyPlus,
  Eye,
  FileJson,
  Send,
  Trash2,
  UploadCloud,
} from 'lucide-react';
import { useDeleteFlow, useDeprecateFlow, usePublishFlow, type Flow } from '@/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ConfirmDialog, FLOW_CATEGORY_LABEL, FlowStatusBadge } from './flow-ui';

type LifecycleAction = 'publish' | 'deprecate' | 'delete';

interface Props {
  instanceId: string;
  flows: Flow[];
  onOpen: (flow: Flow) => void;
  onSend: (flow: Flow) => void;
  onClone: (flow: Flow) => void;
}

export function FlowList({ instanceId, flows, onOpen, onSend, onClone }: Props) {
  const [confirming, setConfirming] = useState<{ action: LifecycleAction; flow: Flow } | null>(
    null,
  );
  const publish = usePublishFlow(instanceId);
  const deprecate = useDeprecateFlow(instanceId);
  const remove = useDeleteFlow(instanceId);
  const mutations = { publish, deprecate, delete: remove };

  const ask = (action: LifecycleAction, flow: Flow) => {
    mutations[action].reset();
    setConfirming({ action, flow });
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {flows.map((f) => {
          const errors = f.validation_errors?.length ?? 0;
          const draft = f.status === 'DRAFT';
          return (
            <Card key={f.id} className="flex flex-col">
              <CardHeader className="pb-2">
                <CardTitle className="truncate text-sm" title={f.name}>
                  {f.name}
                </CardTitle>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  <FlowStatusBadge status={f.status} />
                  {(f.categories ?? []).map((c) => (
                    <Badge key={c} variant="outline">
                      {FLOW_CATEGORY_LABEL[c] ?? c}
                    </Badge>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-3">
                <div className="flex-1 space-y-1 text-xs text-muted-foreground">
                  <p className="truncate" title={f.id}>
                    ID <code>{f.id}</code>
                  </p>
                  {errors > 0 ? (
                    <p className="flex items-center gap-1 text-amber-500">
                      <AlertTriangle className="size-3.5 shrink-0" /> {errors} erro(s) de validação
                    </p>
                  ) : (
                    <p>Sem erros de validação</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => onOpen(f)}>
                    {draft ? <FileJson /> : <Eye />} {draft ? 'Editar JSON' : 'Detalhes'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => onSend(f)}>
                    <Send /> Enviar teste
                  </Button>
                  {draft && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => ask('publish', f)}>
                        <UploadCloud /> Publicar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => ask('delete', f)}
                        aria-label={`Apagar ${f.name}`}
                        title="Apagar"
                      >
                        <Trash2 />
                      </Button>
                    </>
                  )}
                  {f.status === 'PUBLISHED' && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => onClone(f)}>
                        <CopyPlus /> Clonar
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => ask('deprecate', f)}
                      >
                        <Archive /> Depreciar
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {confirming && (
        <LifecycleConfirm
          action={confirming.action}
          flow={confirming.flow}
          pending={mutations[confirming.action].isPending}
          error={mutations[confirming.action].error}
          onClose={() => setConfirming(null)}
          onConfirm={() =>
            mutations[confirming.action].mutate(confirming.flow.id, {
              onSuccess: () => setConfirming(null),
            })
          }
        />
      )}
    </>
  );
}

function LifecycleConfirm({
  action,
  flow,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  action: LifecycleAction;
  flow: Flow;
  pending: boolean;
  error: unknown;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const errors = flow.validation_errors?.length ?? 0;
  const common = { pending, error, onClose, onConfirm };

  if (action === 'publish') {
    return (
      <ConfirmDialog title={`Publicar «${flow.name}»?`} confirmLabel="Publicar" {...common}>
        <p>
          Depois de publicado o Flow fica <b>imutável</b>: o Flow JSON e os metadados não podem mais
          ser editados, e ele não pode ser apagado — só depreciado.
        </p>
        <p>Para mudar algo depois, é preciso clonar o Flow e publicar o clone.</p>
        {errors > 0 && (
          <p className="text-amber-500">
            Este rascunho tem {errors} erro(s) de validação — a Meta deve recusar a publicação.
          </p>
        )}
      </ConfirmDialog>
    );
  }
  if (action === 'deprecate') {
    return (
      <ConfirmDialog
        title={`Depreciar «${flow.name}»?`}
        confirmLabel="Depreciar"
        destructive
        {...common}
      >
        <p>
          A depreciação é <b>irreversível</b>: o Flow passa a DEPRECATED, não pode mais ser enviado
          nem aberto e não volta a PUBLISHED.
        </p>
        <p>Se ainda precisar dele, clone-o antes ou depois e publique o clone.</p>
      </ConfirmDialog>
    );
  }
  return (
    <ConfirmDialog title={`Apagar «${flow.name}»?`} confirmLabel="Apagar" destructive {...common}>
      <p>
        O rascunho e o seu Flow JSON são <b>apagados definitivamente</b> na Meta. Não há como
        desfazer.
      </p>
    </ConfirmDialog>
  );
}
