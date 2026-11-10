import { useEffect, useState } from 'react';
import { History, KeyRound, Plus, RefreshCw, Workflow } from 'lucide-react';
import { useFlowEndpoint, useFlows, useInstances, type Flow } from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { CreateFlowDialog } from '@/components/flows/CreateFlowDialog';
import { FlowDetailDialog } from '@/components/flows/FlowDetailDialog';
import { FlowEndpointSection } from '@/components/flows/FlowEndpointSection';
import { FlowList } from '@/components/flows/FlowList';
import { FlowSessionsTab } from '@/components/flows/FlowSessionsTab';
import { SendFlowDialog } from '@/components/flows/SendFlowDialog';
import { ErrorNote } from '@/components/flows/flow-ui';

type Tab = 'flows' | 'endpoint' | 'sessions';
const TABS: { id: Tab; label: string; icon: typeof Workflow }[] = [
  { id: 'flows', label: 'Flows', icon: Workflow },
  { id: 'endpoint', label: 'Endpoint & criptografia', icon: KeyRound },
  { id: 'sessions', label: 'Execuções', icon: History },
];

/** Diálogo aberto por cima da página — um por vez. */
type Overlay =
  | { kind: 'create'; cloneFrom?: Flow }
  | { kind: 'detail'; flowId: string }
  | { kind: 'send'; flow: Flow }
  | null;

export function FlowsPage() {
  const { data: instances } = useInstances();
  const [instanceId, setInstanceId] = useState('');
  const [tab, setTab] = useState<Tab>('flows');
  const [overlay, setOverlay] = useState<Overlay>(null);

  // mesma escolha inicial da página de Templates: prefere uma cloud conectada.
  useEffect(() => {
    if (!instanceId && instances?.length) {
      const cloud = instances.find((i) => i.provider === 'cloud' && i.status === 'connected');
      const connected = instances.find((i) => i.status === 'connected');
      setInstanceId((cloud ?? connected ?? instances[0]).id);
    }
  }, [instances, instanceId]);

  const provider = instances?.find((i) => i.id === instanceId)?.provider;
  const isCloud = provider === 'cloud';
  const notCloud = !!provider && !isCloud;

  // só consulta a API quando a engine é cloud — as demais respondem 501.
  const flows = useFlows(instanceId || null, isCloud);
  const endpoint = useFlowEndpoint(instanceId || null, isCloud);
  const list = flows.data ?? [];

  const selectCls = 'h-9 rounded-md border border-input bg-transparent px-2 text-sm';

  // `grid-cols-1` (= minmax(0, 1fr)) em vez de `space-y`: zera a largura mínima
  // intrínseca da página, senão a tabela de execuções e nomes longos de Flow
  // alargam o <main> do shell (flex sem min-w-0) além da viewport no celular.
  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Workflow className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Flows (Cloud API)</h1>
        <select
          value={instanceId}
          onChange={(e) => {
            setInstanceId(e.target.value);
            setOverlay(null);
          }}
          className={cn(selectCls, 'min-w-0 max-w-full')}
          aria-label="Instância"
        >
          <option value="">— selecione a instância —</option>
          {(instances ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.provider}, {i.status})
            </option>
          ))}
        </select>
        {isCloud && tab === 'flows' && (
          <>
            <Button variant="outline" size="sm" onClick={() => flows.refetch()}>
              <RefreshCw className={cn('size-4', flows.isFetching && 'animate-spin')} /> Recarregar
            </Button>
            <Button size="sm" onClick={() => setOverlay({ kind: 'create' })}>
              <Plus /> Novo Flow
            </Button>
            {!!list.length && (
              <span className="text-sm text-muted-foreground">{list.length} flow(s)</span>
            )}
          </>
        )}
      </div>

      {notCloud && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            A gestão de WhatsApp Flows é exclusiva da <b>Cloud API oficial</b> (Meta). A engine{' '}
            <b>{provider}</b> responde <code>501</code> — selecione (ou crie) uma instância{' '}
            <code>cloud</code>.
          </CardContent>
        </Card>
      )}

      {!instanceId && instances && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {instances.length
              ? 'Selecione uma instância para gerenciar os Flows.'
              : 'Nenhuma instância ainda. Crie uma instância cloud para usar Flows.'}
          </CardContent>
        </Card>
      )}

      {isCloud && (
        <>
          <div className="flex gap-1 overflow-x-auto border-b" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  '-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2 text-sm transition-colors',
                  tab === t.id
                    ? 'border-primary font-medium text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                <t.icon className="size-4" />
                {t.label}
              </button>
            ))}
          </div>

          {tab === 'flows' && (
            <div className="space-y-3">
              {flows.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
              {flows.isError && (
                <Card>
                  <CardContent className="space-y-2 py-4">
                    <ErrorNote error={flows.error} />
                    <Button variant="outline" size="sm" onClick={() => flows.refetch()}>
                      Tentar de novo
                    </Button>
                  </CardContent>
                </Card>
              )}
              {flows.isSuccess && !list.length && (
                <Card>
                  <CardContent className="py-6 text-center text-sm text-muted-foreground">
                    Nenhum Flow nesta conta ainda. Crie o primeiro em «Novo Flow».
                  </CardContent>
                </Card>
              )}
              <FlowList
                instanceId={instanceId}
                flows={list}
                onOpen={(f) => setOverlay({ kind: 'detail', flowId: f.id })}
                onSend={(f) => setOverlay({ kind: 'send', flow: f })}
                onClone={(f) => setOverlay({ kind: 'create', cloneFrom: f })}
              />
            </div>
          )}

          {tab === 'endpoint' && <FlowEndpointSection key={instanceId} instanceId={instanceId} />}
          {tab === 'sessions' && (
            <FlowSessionsTab key={instanceId} instanceId={instanceId} flows={list} />
          )}
        </>
      )}

      {isCloud && overlay?.kind === 'create' && (
        <CreateFlowDialog
          instanceId={instanceId}
          cloneFrom={overlay.cloneFrom}
          gatewayEndpointUri={endpoint.data?.endpointUri}
          onClose={() => setOverlay(null)}
          onOpenFlow={(flowId) => setOverlay({ kind: 'detail', flowId })}
        />
      )}
      {isCloud && overlay?.kind === 'detail' && (
        <FlowDetailDialog
          key={overlay.flowId}
          instanceId={instanceId}
          flowId={overlay.flowId}
          gatewayEndpointUri={endpoint.data?.endpointUri}
          onClose={() => setOverlay(null)}
          onClone={(f) => setOverlay({ kind: 'create', cloneFrom: f })}
          onSend={(f) => setOverlay({ kind: 'send', flow: f })}
        />
      )}
      {isCloud && overlay?.kind === 'send' && (
        <SendFlowDialog
          key={overlay.flow.id}
          instanceId={instanceId}
          flow={overlay.flow}
          onClose={() => setOverlay(null)}
        />
      )}
    </div>
  );
}
