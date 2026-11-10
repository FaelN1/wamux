import { useState } from 'react';
import { CheckCircle2, Send } from 'lucide-react';
import { useSendFlow, type Flow, type SendFlowResult } from '@/api';
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
import { CopyField, ErrorNote, isRecord, selectCls, textareaCls } from './flow-ui';

const CTA_MAX = 30;

type Mode = 'draft' | 'published';
type Action = 'navigate' | 'data_exchange';

/** `data` é opcional; se vier, tem de ser um objeto JSON não vazio (regra da Meta). */
function parseData(text: string): { data?: Record<string, unknown>; error?: string } {
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `JSON inválido: ${e instanceof Error ? e.message : ''}` };
  }
  if (!isRecord(parsed)) return { error: 'Precisa ser um objeto JSON ({ … }).' };
  if (!Object.keys(parsed).length) return { error: 'Se informado, não pode ser vazio.' };
  return { data: parsed };
}

export function SendFlowDialog({
  instanceId,
  flow,
  onClose,
}: {
  instanceId: string;
  flow: Flow;
  onClose: () => void;
}) {
  const send = useSendFlow(instanceId);
  const [to, setTo] = useState('');
  const [cta, setCta] = useState('Abrir');
  const [body, setBody] = useState('');
  const [header, setHeader] = useState('');
  const [footer, setFooter] = useState('');
  const [mode, setMode] = useState<Mode>(flow.status === 'DRAFT' ? 'draft' : 'published');
  const [action, setAction] = useState<Action>('navigate');
  const [screen, setScreen] = useState('');
  const [dataText, setDataText] = useState('');
  const [result, setResult] = useState<SendFlowResult | null>(null);

  const parsed = parseData(dataText);
  const invalid =
    !to.trim() ||
    !cta.trim() ||
    cta.length > CTA_MAX ||
    !body.trim() ||
    (action === 'navigate' && !screen.trim()) ||
    !!parsed.error ||
    send.isPending;

  const submit = () => {
    if (invalid) return;
    setResult(null);
    send.mutate(
      {
        to: to.trim(),
        flowId: flow.id,
        cta: cta.trim(),
        body: body.trim(),
        mode,
        action,
        ...(header.trim() ? { header: header.trim() } : {}),
        ...(footer.trim() ? { footer: footer.trim() } : {}),
        ...(screen.trim() ? { screen: screen.trim() } : {}),
        ...(parsed.data ? { data: parsed.data } : {}),
      },
      { onSuccess: setResult },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="size-4 text-primary" /> Enviar teste — «{flow.name}»
          </DialogTitle>
          <DialogDescription>
            Envia a mensagem interativa que abre o Flow no chat do destinatário.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sf-to">Destinatário (número com DDI)</Label>
              <Input
                id="sf-to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="5511999999999"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="sf-cta">Botão (CTA)</Label>
                <span
                  className={cn(
                    'text-xs',
                    cta.length > CTA_MAX ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {cta.length}/{CTA_MAX}
                </span>
              </div>
              <Input
                id="sf-cta"
                value={cta}
                maxLength={CTA_MAX}
                onChange={(e) => setCta(e.target.value)}
                placeholder="Agendar"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-body">Corpo</Label>
            <textarea
              id="sf-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={2}
              className={textareaCls}
              placeholder="Escolha o melhor horário."
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sf-header">Cabeçalho (opcional)</Label>
              <Input id="sf-header" value={header} onChange={(e) => setHeader(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sf-footer">Rodapé (opcional)</Label>
              <Input id="sf-footer" value={footer} onChange={(e) => setFooter(e.target.value)} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="sf-mode">Modo</Label>
              <select
                id="sf-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as Mode)}
                className={selectCls}
              >
                <option value="draft">draft — envia o rascunho</option>
                <option value="published">published — versão publicada</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sf-action">Ação</Label>
              <select
                id="sf-action"
                value={action}
                onChange={(e) => setAction(e.target.value as Action)}
                className={selectCls}
              >
                <option value="navigate">navigate — abre numa tela</option>
                <option value="data_exchange">data_exchange — 1ª tela vem do endpoint</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-screen">
              Tela inicial {action === 'navigate' ? '(obrigatória)' : '(opcional)'}
            </Label>
            <Input
              id="sf-screen"
              value={screen}
              onChange={(e) => setScreen(e.target.value)}
              placeholder="WELCOME_SCREEN"
              className="font-mono"
            />
            {action === 'data_exchange' && (
              <p className="text-xs text-muted-foreground">
                Com data_exchange o seu endpoint recebe <code>INIT</code> e devolve a primeira tela.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="sf-data">Dados iniciais — JSON (opcional)</Label>
            <textarea
              id="sf-data"
              value={dataText}
              onChange={(e) => setDataText(e.target.value)}
              rows={3}
              spellCheck={false}
              className={cn(textareaCls, 'font-mono text-xs')}
              placeholder='{ "nome": "Maria" }'
            />
            {parsed.error && <p className="text-xs text-destructive">{parsed.error}</p>}
          </div>

          <ErrorNote error={send.error} />

          {result && (
            <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
              <p className="flex items-center gap-1.5 text-sm font-medium text-emerald-500">
                <CheckCircle2 className="size-4 shrink-0" /> Enviado
                {result.status ? ` (${result.status})` : ''}
              </p>
              {result.flowToken ? (
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">
                    flowToken desta execução — é a chave para achá-la na aba Execuções e no evento{' '}
                    <code>flow.response</code>:
                  </p>
                  <CopyField value={result.flowToken} />
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  A API não devolveu um flowToken para este envio.
                </p>
              )}
              {result.id && (
                <p className="break-all text-xs text-muted-foreground">
                  Mensagem: <code>{result.id}</code>
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <Button onClick={submit} disabled={invalid}>
              <Send /> {send.isPending ? 'Enviando…' : result ? 'Enviar de novo' : 'Enviar'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
