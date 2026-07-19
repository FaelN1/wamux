import { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, RefreshCw, Send, Trash2, X } from 'lucide-react';
import {
  useInstances,
  useTemplates,
  useCreateTemplate,
  useDeleteTemplate,
  useSendTemplate,
  type MessageTemplate,
} from '@/api';
import type { TemplateComponent } from '@wamux/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
const LANGS = ['pt_BR', 'en_US', 'es_ES', 'pt_PT', 'en_GB'];

/** cor do badge por status do template. */
function statusClass(status: string): string {
  if (status === 'APPROVED') return 'bg-emerald-500/15 text-emerald-500';
  if (status === 'PENDING' || status === 'IN_REVIEW' || status === 'APPEAL_REQUESTED')
    return 'bg-amber-500/15 text-amber-500';
  return 'bg-red-500/15 text-red-500';
}
function qualityClass(q?: string): string {
  if (q === 'GREEN') return 'bg-emerald-500/15 text-emerald-500';
  if (q === 'YELLOW') return 'bg-amber-500/15 text-amber-500';
  if (q === 'RED') return 'bg-red-500/15 text-red-500';
  return 'bg-muted text-muted-foreground';
}

/** texto do BODY de um template, para preview. */
function bodyText(t: MessageTemplate): string {
  const b = t.components?.find((c) => c.type === 'BODY') as { text?: string } | undefined;
  return b?.text ?? '';
}
/** nº de placeholders {{n}} no body — quantos params o envio precisa. */
function paramCount(t: MessageTemplate): number {
  return (bodyText(t).match(/\{\{\s*\d+\s*\}\}/g) ?? []).length;
}

export function TemplatesPage() {
  const { data: instances } = useInstances();
  const [instanceId, setInstanceId] = useState('');

  useEffect(() => {
    if (!instanceId && instances?.length) {
      const cloud = instances.find((i) => i.provider === 'cloud' && i.status === 'connected');
      const connected = instances.find((i) => i.status === 'connected');
      setInstanceId((cloud ?? connected ?? instances[0]).id);
    }
  }, [instances, instanceId]);

  const templates = useTemplates(instanceId || null);
  const createMut = useCreateTemplate(instanceId);
  const deleteMut = useDeleteTemplate(instanceId);
  const sendMut = useSendTemplate(instanceId);

  const provider = instances?.find((i) => i.id === instanceId)?.provider;
  const notCloud = provider && provider !== 'cloud';

  // ── form de criação ──
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('pt_BR');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('MARKETING');
  const [header, setHeader] = useState('');
  const [body, setBody] = useState('');
  const [footer, setFooter] = useState('');

  const create = () => {
    const components: TemplateComponent[] = [];
    if (header.trim()) components.push({ type: 'HEADER', format: 'TEXT', text: header.trim() });
    const bodyComp: TemplateComponent = { type: 'BODY', text: body.trim() };
    const vars = body.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
    if (vars.length) {
      // a Meta exige example quando há placeholders.
      (bodyComp as { example?: unknown }).example = {
        body_text: [vars.map((_, i) => `exemplo${i + 1}`)],
      };
    }
    components.push(bodyComp);
    if (footer.trim()) components.push({ type: 'FOOTER', text: footer.trim() });
    createMut.mutate(
      { name: name.trim(), language, category, components },
      {
        onSuccess: () => {
          setName('');
          setHeader('');
          setBody('');
          setFooter('');
        },
      },
    );
  };

  // ── painel de envio ──
  const [sending, setSending] = useState<MessageTemplate | null>(null);
  const [sendTo, setSendTo] = useState('');
  const [sendParams, setSendParams] = useState('');
  const [sentMsg, setSentMsg] = useState('');

  const doSend = () => {
    if (!sending) return;
    const params = sendParams
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((text) => ({ type: 'text' as const, text }));
    sendMut.mutate(
      {
        to: sendTo.trim(),
        name: sending.name,
        language: sending.language,
        components: params.length ? [{ type: 'body', parameters: params }] : undefined,
      },
      {
        onSuccess: (r) => {
          setSentMsg(`Enviado: ${(r as { id?: string })?.id ?? 'ok'}`);
          setSendTo('');
          setSendParams('');
        },
        onError: (e) => setSentMsg(`Erro: ${(e as Error).message}`),
      },
    );
  };

  const list = templates.data ?? [];
  const createDisabled = !instanceId || !name.trim() || !body.trim() || createMut.isPending;

  const sortedLangs = useMemo(
    () => (LANGS.includes(language) ? LANGS : [language, ...LANGS]),
    [language],
  );

  return (
    <div className="space-y-6">
      {/* controles */}
      <div className="flex flex-wrap items-center gap-3">
        <FileText className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Templates (Cloud API)</h1>
        <select
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">— selecione a instância —</option>
          {(instances ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.provider}, {i.status})
            </option>
          ))}
        </select>
        <Button variant="outline" size="sm" onClick={() => templates.refetch()}>
          <RefreshCw className={cn('size-4', templates.isFetching && 'animate-spin')} /> Recarregar
        </Button>
        {!!list.length && (
          <span className="text-sm text-muted-foreground">{list.length} template(s)</span>
        )}
      </div>

      {notCloud && (
        <Card>
          <CardContent className="py-4 text-sm text-muted-foreground">
            Templates HSM são exclusivos da <b>Cloud API oficial</b> (Meta). A engine{' '}
            <b>{provider}</b> responde <code>501</code> — selecione (ou crie) uma instância{' '}
            <code>cloud</code> para gerenciar templates.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        {/* criar */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="size-4 text-primary" /> Novo template
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Nome</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                placeholder="promo_verao"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Língua</Label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  {sortedLangs.map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label>Categoria</Label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as (typeof CATEGORIES)[number])}
                  className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Cabeçalho (opcional)</Label>
              <Input
                value={header}
                onChange={(e) => setHeader(e.target.value)}
                placeholder="Texto do topo"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Corpo</Label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
                placeholder="Use {{1}} e ganhe {{2}} de desconto"
              />
              <p className="text-xs text-muted-foreground">
                Placeholders <code>{'{{1}}'}</code> viram parâmetros no envio.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>Rodapé (opcional)</Label>
              <Input
                value={footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Responda SAIR para cancelar"
              />
            </div>
            <Button onClick={create} disabled={createDisabled} className="w-full">
              <Plus /> Criar (entra em review)
            </Button>
            {createMut.isError && (
              <p className="text-xs text-destructive">{(createMut.error as Error).message}</p>
            )}
            {createMut.isSuccess && (
              <p className="text-xs text-emerald-500">
                Template criado — aguardando aprovação da Meta.
              </p>
            )}
          </CardContent>
        </Card>

        {/* lista */}
        <div className="space-y-3">
          {sending && (
            <Card className="border-primary/40">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center justify-between text-base">
                  <span className="flex items-center gap-2">
                    <Send className="size-4 text-primary" /> Enviar «{sending.name}»
                  </span>
                  <button
                    onClick={() => setSending(null)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-4" />
                  </button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Destinatário (número)</Label>
                  <Input
                    value={sendTo}
                    onChange={(e) => setSendTo(e.target.value)}
                    placeholder="5511999999999"
                  />
                </div>
                {paramCount(sending) > 0 && (
                  <div className="space-y-1.5">
                    <Label>
                      Parâmetros do corpo ({paramCount(sending)}), separados por vírgula
                    </Label>
                    <Input
                      value={sendParams}
                      onChange={(e) => setSendParams(e.target.value)}
                      placeholder="CUPOM, 25%"
                    />
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button onClick={doSend} disabled={!sendTo.trim() || sendMut.isPending}>
                    <Send /> Enviar
                  </Button>
                  {sentMsg && <span className="text-xs text-muted-foreground">{sentMsg}</span>}
                </div>
              </CardContent>
            </Card>
          )}

          {templates.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {templates.isError && !notCloud && (
            <Card>
              <CardContent className="py-4 text-sm text-destructive">
                {(templates.error as Error).message}
              </CardContent>
            </Card>
          )}
          {!templates.isLoading && !templates.isError && !list.length && (
            <Card>
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                Nenhum template ainda. Crie o primeiro ao lado.
              </CardContent>
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {list.map((t) => (
              <Card key={t.id} className="flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="truncate text-sm" title={t.name}>
                    {t.name}
                  </CardTitle>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Badge className={statusClass(t.status)}>{t.status}</Badge>
                    {t.quality_score && (
                      <Badge className={qualityClass(t.quality_score)}>{t.quality_score}</Badge>
                    )}
                    <Badge variant="outline">{t.category}</Badge>
                    <Badge variant="secondary">{t.language}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-1 flex-col gap-3">
                  <p className="line-clamp-3 flex-1 text-xs text-muted-foreground">
                    {bodyText(t) || '—'}
                  </p>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={t.status !== 'APPROVED'}
                      title={
                        t.status !== 'APPROVED' ? 'Só templates APPROVED podem ser enviados' : ''
                      }
                      onClick={() => {
                        setSending(t);
                        setSentMsg('');
                        setSendParams('');
                      }}
                    >
                      <Send className="size-4" /> Enviar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive hover:text-destructive"
                      disabled={deleteMut.isPending}
                      onClick={() => {
                        if (confirm(`Apagar o template "${t.name}" (todas as línguas)?`))
                          deleteMut.mutate(t.name);
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
