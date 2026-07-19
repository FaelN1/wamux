import { useEffect, useMemo, useState } from 'react';
import {
  ChevronLeft,
  Copy,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Phone,
  Plus,
  Reply,
  RefreshCw,
  Send,
  Trash2,
  Video,
  X,
} from 'lucide-react';
import {
  useInstances,
  useTemplates,
  useCreateTemplate,
  useDeleteTemplate,
  useSendTemplate,
  type MessageTemplate,
} from '@/api';
import type { TemplateButton, TemplateComponent } from '@wamux/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'] as const;
const LANGS = ['pt_BR', 'en_US', 'es_ES', 'pt_PT', 'en_GB'];
const HEADER_FORMATS = ['NONE', 'TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT'] as const;

/** Limites oficiais da Meta impostos no builder. */
const LIM = {
  name: 512,
  headerText: 60,
  body: 1024,
  footer: 60,
  buttonsTotal: 10,
  url: 2,
  phone: 1,
  copy: 1,
  otp: 1,
  buttonText: 25,
};

type BtnType = 'QUICK_REPLY' | 'URL' | 'PHONE_NUMBER' | 'COPY_CODE' | 'OTP' | 'FLOW';
const BTN_LABEL: Record<BtnType, string> = {
  QUICK_REPLY: 'Resposta rápida',
  URL: 'Link (URL)',
  PHONE_NUMBER: 'Telefone',
  COPY_CODE: 'Copiar código',
  OTP: 'OTP (senha)',
  FLOW: 'Flow',
};
interface BtnDraft {
  type: BtnType;
  text: string;
  url: string;
  phone_number: string;
  otp_type: 'COPY_CODE' | 'ONE_TAP' | 'ZERO_TAP';
  flow_id: string;
}
const newBtn = (type: BtnType): BtnDraft => ({
  type,
  text: '',
  url: '',
  phone_number: '',
  otp_type: 'COPY_CODE',
  flow_id: '',
});

function toButton(b: BtnDraft): TemplateButton {
  switch (b.type) {
    case 'QUICK_REPLY':
      return { type: 'QUICK_REPLY', text: b.text };
    case 'URL':
      return {
        type: 'URL',
        text: b.text,
        url: b.url,
        ...(b.url.includes('{{') ? { example: ['https://exemplo.com/x'] } : {}),
      };
    case 'PHONE_NUMBER':
      return { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone_number };
    case 'COPY_CODE':
      return { type: 'COPY_CODE', ...(b.text ? { text: b.text } : {}) };
    case 'OTP':
      return { type: 'OTP', otp_type: b.otp_type };
    case 'FLOW':
      return { type: 'FLOW', text: b.text, ...(b.flow_id ? { flow_id: b.flow_id } : {}) };
  }
}

// ── helpers de badge/preview ──
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
function bodyText(t: MessageTemplate): string {
  const b = t.components?.find((c) => c.type === 'BODY') as { text?: string } | undefined;
  return b?.text ?? '';
}
function templateButtons(t: MessageTemplate): TemplateButton[] {
  const b = t.components?.find((c) => c.type === 'BUTTONS') as
    { buttons?: TemplateButton[] } | undefined;
  return b?.buttons ?? [];
}
function vars(text: string): string[] {
  return text.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
}
function paramCount(t: MessageTemplate): number {
  return vars(bodyText(t)).length;
}

/** contador de caracteres com cor ao estourar. */
function Counter({ n, max }: { n: number; max: number }) {
  return (
    <span className={cn('text-[10px]', n > max ? 'text-destructive' : 'text-muted-foreground')}>
      {n}/{max}
    </span>
  );
}

/** substitui {{n}} pelo exemplo correspondente (fallback: mantém o token). */
function fillVars(text: string, examples: string[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_, n) => examples[Number(n) - 1] || `{{${n}}}`);
}

const BTN_ICON: Partial<Record<BtnType, typeof Reply>> = {
  QUICK_REPLY: Reply,
  URL: ExternalLink,
  PHONE_NUMBER: Phone,
  COPY_CODE: Copy,
  OTP: Copy,
};
const MEDIA_ICON = { IMAGE: ImageIcon, VIDEO: Video, DOCUMENT: FileText } as const;

interface PreviewProps {
  headerFormat: (typeof HEADER_FORMATS)[number];
  headerText: string;
  headerExample: string;
  body: string;
  bodyExamples: string[];
  footer: string;
  buttons: BtnDraft[];
}

/** Mock de telefone WhatsApp com preview ao vivo do template sendo montado. */
function TemplatePreview(p: PreviewProps) {
  const filledHeader = p.headerFormat === 'TEXT' ? fillVars(p.headerText, [p.headerExample]) : '';
  const filledBody = fillVars(p.body, p.bodyExamples);
  const isMedia = p.headerFormat !== 'NONE' && p.headerFormat !== 'TEXT';
  const MediaIcon = isMedia ? MEDIA_ICON[p.headerFormat as keyof typeof MEDIA_ICON] : null;

  // WhatsApp mostra até 3 botões; acima disso, colapsa em "Ver todas as opções".
  const collapse = p.buttons.length > 3;
  const shown = collapse ? p.buttons.slice(0, 2) : p.buttons;
  const btnLabel = (b: BtnDraft) =>
    b.text.trim() ||
    (b.type === 'COPY_CODE' || b.type === 'OTP' ? 'Copiar código' : BTN_LABEL[b.type]);

  return (
    <div className="mx-auto w-[300px] select-none overflow-hidden rounded-[2rem] border-[6px] border-neutral-900 bg-neutral-900 shadow-xl">
      {/* barra do topo */}
      <div className="flex items-center gap-2 bg-[#075E54] px-3 py-2.5 text-white">
        <ChevronLeft className="size-4 opacity-80" />
        <div className="size-7 rounded-full bg-white/25" />
        <div className="leading-tight">
          <div className="text-sm font-medium">Prévia</div>
          <div className="text-[10px] text-white/70">conta business</div>
        </div>
      </div>
      {/* área do chat */}
      <div className="min-h-[380px] space-y-1.5 bg-[#ECE5DD] p-3">
        <div className="max-w-[90%] rounded-lg rounded-tl-none bg-white p-1.5 shadow-sm">
          {isMedia && MediaIcon && (
            <div className="mb-1 flex h-24 flex-col items-center justify-center gap-1 rounded bg-black/[0.06] text-neutral-400">
              <MediaIcon className="size-7" />
              <span className="text-[10px]">{p.headerFormat}</span>
            </div>
          )}
          <div className="px-1 pb-1">
            {filledHeader && (
              <div className="mb-1 text-[13px] font-semibold text-neutral-900">{filledHeader}</div>
            )}
            <div className="whitespace-pre-wrap break-words text-[13px] leading-snug text-neutral-800">
              {filledBody || <span className="text-neutral-400">Prévia do corpo…</span>}
            </div>
            {p.footer && <div className="mt-1.5 text-[11px] text-neutral-400">{p.footer}</div>}
            <div className="mt-0.5 text-right text-[10px] text-neutral-400">agora</div>
          </div>
        </div>
        {shown.length > 0 && (
          <div className="max-w-[90%] space-y-0.5">
            {shown.map((b, i) => {
              const Icon = BTN_ICON[b.type];
              return (
                <div
                  key={i}
                  className="flex items-center justify-center gap-1.5 rounded-lg bg-white py-2 text-[13px] font-medium text-[#00A5F4] shadow-sm"
                >
                  {Icon && <Icon className="size-3.5" />} {btnLabel(b)}
                </div>
              );
            })}
            {collapse && (
              <div className="flex items-center justify-center rounded-lg bg-white py-2 text-[13px] font-medium text-[#00A5F4] shadow-sm">
                Ver todas as opções
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
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

  // ── builder ──
  const [name, setName] = useState('');
  const [language, setLanguage] = useState('pt_BR');
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>('MARKETING');
  const [headerFormat, setHeaderFormat] = useState<(typeof HEADER_FORMATS)[number]>('NONE');
  const [headerText, setHeaderText] = useState('');
  const [headerHandle, setHeaderHandle] = useState('');
  const [headerExample, setHeaderExample] = useState('');
  const [body, setBody] = useState('');
  const [bodyExamples, setBodyExamples] = useState<string[]>([]);
  const [footer, setFooter] = useState('');
  const [buttons, setButtons] = useState<BtnDraft[]>([]);

  const bodyVars = useMemo(() => vars(body), [body]);
  const headerHasVar = headerFormat === 'TEXT' && vars(headerText).length > 0;
  // mantém o array de exemplos do corpo do tamanho do nº de variáveis.
  useEffect(() => {
    setBodyExamples((prev) => bodyVars.map((_, i) => prev[i] ?? ''));
  }, [bodyVars.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const btnCount = (ty: BtnType) => buttons.filter((b) => b.type === ty).length;
  const canAdd = (ty: BtnType): boolean => {
    if (buttons.length >= LIM.buttonsTotal) return false;
    if (ty === 'URL') return btnCount('URL') < LIM.url;
    if (ty === 'PHONE_NUMBER') return btnCount('PHONE_NUMBER') < LIM.phone;
    if (ty === 'COPY_CODE') return btnCount('COPY_CODE') < LIM.copy;
    if (ty === 'OTP') return btnCount('OTP') < LIM.otp;
    return true;
  };
  const addBtn = (ty: BtnType) => canAdd(ty) && setButtons((b) => [...b, newBtn(ty)]);
  const patchBtn = (i: number, patch: Partial<BtnDraft>) =>
    setButtons((b) => b.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const rmBtn = (i: number) => setButtons((b) => b.filter((_, idx) => idx !== i));

  const buttonsValid = buttons.every((b) => {
    if (b.type === 'QUICK_REPLY' || b.type === 'FLOW') return !!b.text.trim();
    if (b.type === 'URL') return !!b.text.trim() && !!b.url.trim();
    if (b.type === 'PHONE_NUMBER') return !!b.text.trim() && !!b.phone_number.trim();
    return true; // COPY_CODE / OTP
  });

  const invalid =
    !instanceId ||
    !name.trim() ||
    !body.trim() ||
    body.length > LIM.body ||
    headerText.length > LIM.headerText ||
    footer.length > LIM.footer ||
    (headerFormat === 'TEXT' && !headerText.trim()) ||
    (headerFormat !== 'NONE' && headerFormat !== 'TEXT' && !headerHandle.trim()) ||
    !buttonsValid ||
    createMut.isPending;

  const resetForm = () => {
    setName('');
    setHeaderFormat('NONE');
    setHeaderText('');
    setHeaderHandle('');
    setHeaderExample('');
    setBody('');
    setBodyExamples([]);
    setFooter('');
    setButtons([]);
  };

  const create = () => {
    const components: TemplateComponent[] = [];
    if (headerFormat === 'TEXT') {
      components.push({
        type: 'HEADER',
        format: 'TEXT',
        text: headerText.trim(),
        ...(headerHasVar ? { example: { header_text: [headerExample || 'exemplo'] } } : {}),
      });
    } else if (headerFormat !== 'NONE') {
      components.push({
        type: 'HEADER',
        format: headerFormat,
        example: { header_handle: [headerHandle.trim()] },
      });
    }
    const bodyComp: TemplateComponent = { type: 'BODY', text: body.trim() };
    if (bodyVars.length) {
      (bodyComp as { example?: unknown }).example = {
        body_text: [bodyExamples.map((e, i) => e || `exemplo${i + 1}`)],
      };
    }
    components.push(bodyComp);
    if (footer.trim()) components.push({ type: 'FOOTER', text: footer.trim() });
    if (buttons.length) components.push({ type: 'BUTTONS', buttons: buttons.map(toButton) });

    createMut.mutate(
      { name: name.trim(), language, category, components },
      { onSuccess: resetForm },
    );
  };

  // ── envio ──
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
  const sortedLangs = useMemo(
    () => (LANGS.includes(language) ? LANGS : [language, ...LANGS]),
    [language],
  );

  const inputCls = 'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <FileText className="size-5 text-primary" />
        <h1 className="text-lg font-semibold">Templates (Cloud API)</h1>
        <select
          value={instanceId}
          onChange={(e) => setInstanceId(e.target.value)}
          className={inputCls + ' w-auto'}
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
            <code>cloud</code>.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,440px)_320px]">
        {/* ── builder ── */}
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="size-4 text-primary" /> Novo template
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* identidade */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Nome</Label>
                <Counter n={name.length} max={LIM.name} />
              </div>
              <Input
                value={name}
                maxLength={LIM.name}
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
                  className={inputCls}
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
                  className={inputCls}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* header */}
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <div className="flex items-center justify-between">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Cabeçalho
                </Label>
                <select
                  value={headerFormat}
                  onChange={(e) =>
                    setHeaderFormat(e.target.value as (typeof HEADER_FORMATS)[number])
                  }
                  className="h-7 rounded border border-input bg-transparent px-1.5 text-xs"
                >
                  {HEADER_FORMATS.map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </div>
              {headerFormat === 'TEXT' && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground">
                      Texto (até 1 variável {'{{1}}'})
                    </span>
                    <Counter n={headerText.length} max={LIM.headerText} />
                  </div>
                  <Input
                    value={headerText}
                    maxLength={LIM.headerText}
                    onChange={(e) => setHeaderText(e.target.value)}
                    placeholder="Olá, {{1}}!"
                  />
                  {headerHasVar && (
                    <Input
                      value={headerExample}
                      onChange={(e) => setHeaderExample(e.target.value)}
                      placeholder="exemplo p/ {{1}} (ex.: Maria)"
                    />
                  )}
                </>
              )}
              {headerFormat !== 'NONE' && headerFormat !== 'TEXT' && (
                <>
                  <Input
                    value={headerHandle}
                    onChange={(e) => setHeaderHandle(e.target.value)}
                    placeholder={`handle da mídia (${headerFormat})`}
                  />
                  <p className="text-[10px] text-amber-500">
                    Cabeçalho de mídia exige um <b>handle</b> da Resumable Upload API (helper de
                    upload é sub-tarefa pendente).
                  </p>
                </>
              )}
            </div>

            {/* body */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Corpo</Label>
                <Counter n={body.length} max={LIM.body} />
              </div>
              <textarea
                value={body}
                maxLength={LIM.body}
                onChange={(e) => setBody(e.target.value)}
                rows={4}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none"
                placeholder="Use {{1}} e ganhe {{2}} de desconto"
              />
              {bodyVars.length > 0 && (
                <div className="space-y-1.5 rounded-md bg-muted/40 p-2">
                  <p className="text-[10px] text-muted-foreground">
                    Exemplos das variáveis (a Meta exige):
                  </p>
                  {bodyVars.map((v, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-9 text-xs text-muted-foreground">{v}</span>
                      <Input
                        value={bodyExamples[i] ?? ''}
                        onChange={(e) =>
                          setBodyExamples((prev) =>
                            prev.map((x, idx) => (idx === i ? e.target.value : x)),
                          )
                        }
                        placeholder={`exemplo ${i + 1}`}
                        className="h-8"
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* footer */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Rodapé (sem variáveis)</Label>
                <Counter n={footer.length} max={LIM.footer} />
              </div>
              <Input
                value={footer}
                maxLength={LIM.footer}
                onChange={(e) => setFooter(e.target.value)}
                placeholder="Responda SAIR para cancelar"
              />
            </div>

            {/* buttons */}
            <div className="space-y-2 rounded-md border border-border/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                  Botões ({buttons.length}/{LIM.buttonsTotal})
                </Label>
                <span className="text-[10px] text-muted-foreground">
                  URL {btnCount('URL')}/{LIM.url} · Tel {btnCount('PHONE_NUMBER')}/{LIM.phone} · Cód{' '}
                  {btnCount('COPY_CODE')}/{LIM.copy}
                </span>
              </div>

              {buttons.map((b, i) => (
                <div key={i} className="space-y-1.5 rounded border border-border/50 p-2">
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary" className="text-[10px]">
                      {BTN_LABEL[b.type]}
                    </Badge>
                    <button
                      onClick={() => rmBtn(i)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                  {b.type !== 'OTP' && (
                    <Input
                      value={b.text}
                      maxLength={LIM.buttonText}
                      onChange={(e) => patchBtn(i, { text: e.target.value })}
                      placeholder={b.type === 'COPY_CODE' ? 'rótulo (opcional)' : 'texto do botão'}
                      className="h-8"
                    />
                  )}
                  {b.type === 'URL' && (
                    <Input
                      value={b.url}
                      onChange={(e) => patchBtn(i, { url: e.target.value })}
                      placeholder="https://loja.com/{{1}}"
                      className="h-8"
                    />
                  )}
                  {b.type === 'PHONE_NUMBER' && (
                    <Input
                      value={b.phone_number}
                      onChange={(e) => patchBtn(i, { phone_number: e.target.value })}
                      placeholder="+5511999999999"
                      className="h-8"
                    />
                  )}
                  {b.type === 'OTP' && (
                    <select
                      value={b.otp_type}
                      onChange={(e) =>
                        patchBtn(i, { otp_type: e.target.value as BtnDraft['otp_type'] })
                      }
                      className={inputCls + ' h-8'}
                    >
                      <option value="COPY_CODE">COPY_CODE</option>
                      <option value="ONE_TAP">ONE_TAP</option>
                      <option value="ZERO_TAP">ZERO_TAP</option>
                    </select>
                  )}
                  {b.type === 'FLOW' && (
                    <Input
                      value={b.flow_id}
                      onChange={(e) => patchBtn(i, { flow_id: e.target.value })}
                      placeholder="flow_id (opcional)"
                      className="h-8"
                    />
                  )}
                </div>
              ))}

              <div className="flex flex-wrap gap-1.5 pt-1">
                {(Object.keys(BTN_LABEL) as BtnType[]).map((ty) => (
                  <Button
                    key={ty}
                    size="sm"
                    variant="outline"
                    disabled={!canAdd(ty)}
                    onClick={() => addBtn(ty)}
                  >
                    <Plus className="size-3.5" /> {BTN_LABEL[ty]}
                  </Button>
                ))}
              </div>
            </div>

            <Button onClick={create} disabled={invalid} className="w-full">
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

        {/* ── preview ao vivo, ao lado do formulário ── */}
        <div className="h-fit xl:sticky xl:top-4">
          <TemplatePreview
            headerFormat={headerFormat}
            headerText={headerText}
            headerExample={headerExample}
            body={body}
            bodyExamples={bodyExamples}
            footer={footer}
            buttons={buttons}
          />
        </div>
      </div>

      {/* ── lista + envio (largura cheia) ── */}
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
                  <Label>Parâmetros do corpo ({paramCount(sending)}), separados por vírgula</Label>
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
              Nenhum template ainda. Monte o primeiro ao lado.
            </CardContent>
          </Card>
        )}

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((t) => {
            const btns = templateButtons(t);
            return (
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
                  {btns.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {btns.map((b, i) => (
                        <Badge key={i} variant="outline" className="text-[10px]">
                          {'text' in b && b.text ? b.text : b.type}
                        </Badge>
                      ))}
                    </div>
                  )}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}
