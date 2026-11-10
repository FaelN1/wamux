import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import {
  useFlowSession,
  useFlowSessions,
  type Flow,
  type FlowSession,
  type FlowSessionStatus,
} from '@/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  CopyField,
  ErrorNote,
  JsonBlock,
  SESSION_STATUSES,
  SESSION_STATUS_LABEL,
  SessionStatusBadge,
  formatDate,
  selectCls,
} from './flow-ui';

interface Props {
  instanceId: string;
  /** Flows já carregados — só para mostrar o nome quando a sessão guarda apenas o id. */
  flows: Flow[];
}

/** Aba "Execuções": sessões de Flow (uma por envio), correlacionadas pelo flowToken. */
export function FlowSessionsTab({ instanceId, flows }: Props) {
  const [status, setStatus] = useState<FlowSessionStatus | ''>('');
  const [selected, setSelected] = useState<FlowSession | null>(null);
  const sessions = useFlowSessions(instanceId, status);

  const rows = useMemo(() => sessions.data?.pages.flat() ?? [], [sessions.data]);
  const flowNames = useMemo(() => new Map(flows.map((f) => [f.id, f.name])), [flows]);
  const flowLabel = (s: FlowSession) =>
    s.flowName ?? (s.flowId ? (flowNames.get(s.flowId) ?? s.flowId) : '—');

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as FlowSessionStatus | '')}
          className={cn(selectCls, 'w-auto')}
          aria-label="Filtrar por status"
        >
          <option value="">Todos os status</option>
          {SESSION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {SESSION_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => sessions.refetch()}>
          <RefreshCw className={cn('size-4', sessions.isFetching && 'animate-spin')} /> Recarregar
        </Button>
        {!!rows.length && (
          <span className="text-sm text-muted-foreground">{rows.length} execução(ões)</span>
        )}
      </div>

      {sessions.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
      {sessions.isError && (
        <Card>
          <CardContent className="py-4">
            <ErrorNote error={sessions.error} />
          </CardContent>
        </Card>
      )}
      {sessions.isSuccess && !rows.length && (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            {status
              ? 'Nenhuma execução com este status.'
              : 'Nenhuma execução ainda. Cada Flow enviado por este gateway abre uma linha aqui.'}
          </CardContent>
        </Card>
      )}

      {rows.length > 0 && (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/30 text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Contato</th>
                  <th className="px-4 py-2 text-left font-medium">Flow</th>
                  <th className="px-4 py-2 text-left font-medium">Status</th>
                  <th className="px-4 py-2 text-right font-medium">Trocas</th>
                  <th className="px-4 py-2 text-left font-medium">Última tela</th>
                  <th className="px-4 py-2 text-left font-medium">Criada</th>
                  <th className="px-4 py-2 text-left font-medium">Concluída</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr
                    key={s.id}
                    tabIndex={0}
                    className="cursor-pointer border-b last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                    onClick={() => setSelected(s)}
                    onKeyDown={(e) => e.key === 'Enter' && setSelected(s)}
                  >
                    <td className="whitespace-nowrap px-4 py-2 font-medium">{s.contact ?? '—'}</td>
                    <td className="max-w-[14rem] truncate px-4 py-2" title={flowLabel(s)}>
                      {flowLabel(s)}
                    </td>
                    <td className="px-4 py-2">
                      <SessionStatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums">{s.exchanges}</td>
                    <td className="max-w-[12rem] truncate px-4 py-2 font-mono text-xs">
                      {s.lastScreen ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {formatDate(s.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-muted-foreground">
                      {formatDate(s.completedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {sessions.hasNextPage && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            onClick={() => sessions.fetchNextPage()}
            disabled={sessions.isFetchingNextPage}
          >
            {sessions.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </Button>
        </div>
      )}

      {selected && (
        <SessionDetailDialog
          instanceId={instanceId}
          row={selected}
          flowLabel={flowLabel(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function SessionDetailDialog({
  instanceId,
  row,
  flowLabel,
  onClose,
}: {
  instanceId: string;
  /** linha da lista — mostrada de imediato enquanto o detalhe atualizado carrega. */
  row: FlowSession;
  flowLabel: string;
  onClose: () => void;
}) {
  const detail = useFlowSession(instanceId, row.flowToken);
  const s = detail.data ?? row;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            Execução <SessionStatusBadge status={s.status} />
          </DialogTitle>
          <DialogDescription>
            {s.contact ?? 'contato desconhecido'} · {flowLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {detail.isError && (
            <p className="text-xs text-amber-500">
              Não foi possível atualizar o detalhe ({(detail.error as Error).message}) — mostrando
              os dados da lista.
            </p>
          )}

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">flowToken</p>
            <CopyField value={s.flowToken} />
          </div>

          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <Item label="Flow ID" value={s.flowId} mono />
            <Item label="Modo" value={s.mode} />
            <Item label="Mensagem enviada" value={s.messageId} mono />
            <Item label="Mensagem de resposta" value={s.responseMessageId} mono />
            <Item label="Última tela" value={s.lastScreen} mono />
            <Item label="Última ação" value={s.lastAction} mono />
            <Item label="Trocas com o endpoint" value={String(s.exchanges)} />
            <Item label="Criada" value={formatDate(s.createdAt)} />
            <Item label="Atualizada" value={formatDate(s.updatedAt)} />
            <Item label="Concluída" value={formatDate(s.completedAt)} />
          </dl>

          {s.error && (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-destructive">Erro</p>
              <JsonBlock value={s.error} className="border border-destructive/30" />
            </div>
          )}

          <div className="space-y-1.5">
            <p className="text-sm font-medium">Resposta</p>
            {s.response ? (
              <JsonBlock value={s.response} />
            ) : (
              <p className="text-xs text-muted-foreground">
                {s.status === 'completed'
                  ? 'Concluída, mas a resposta não foi gravada (FLOWS_SAVE_RESPONSE_DATA=false guarda só a correlação).'
                  : 'Sem resposta ainda — ela chega quando o usuário conclui o Flow.'}
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Item({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('break-all', mono && 'font-mono text-xs')}>{value || '—'}</dd>
    </div>
  );
}
