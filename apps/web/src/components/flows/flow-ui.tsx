import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, Copy } from 'lucide-react';
import { ApiError, type FlowCategory, type FlowSessionStatus, type FlowStatus } from '@/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

// ── constantes ───────────────────────────────────────────

export const FLOW_CATEGORY_LABEL: Record<FlowCategory, string> = {
  SIGN_UP: 'Cadastro',
  SIGN_IN: 'Login',
  APPOINTMENT_BOOKING: 'Agendamento',
  LEAD_GENERATION: 'Geração de leads',
  CONTACT_US: 'Fale conosco',
  CUSTOMER_SUPPORT: 'Suporte',
  SURVEY: 'Pesquisa',
  OTHER: 'Outro',
};
export const FLOW_CATEGORIES = Object.keys(FLOW_CATEGORY_LABEL) as FlowCategory[];

export const SESSION_STATUS_LABEL: Record<FlowSessionStatus, string> = {
  sent: 'Enviado',
  in_progress: 'Em andamento',
  completed: 'Concluído',
  failed: 'Falhou',
};
export const SESSION_STATUSES = Object.keys(SESSION_STATUS_LABEL) as FlowSessionStatus[];

/** Mesmas classes de campo que a página de Templates usa nos `<select>`/`<textarea>`. */
export const selectCls = 'h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm';
export const textareaCls =
  'w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60';

const TONE = {
  ok: 'bg-emerald-500/15 text-emerald-500',
  warn: 'bg-amber-500/15 text-amber-500',
  bad: 'bg-red-500/15 text-red-500',
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-sky-500/15 text-sky-500',
} as const;

// ── helpers ──────────────────────────────────────────────

/** Mensagem de erro para a tela; inclui o código do upstream (Meta) quando existe. */
export function errorText(e: unknown): string {
  if (e instanceof ApiError && e.code != null) return `${e.message} (código ${e.code})`;
  return e instanceof Error ? e.message : String(e);
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('pt-BR');
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Tenta reindentar; se não for JSON válido devolve o texto como veio. */
export function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Erro de sintaxe do JSON digitado, ou null se ele parseia. */
export function jsonSyntaxError(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'JSON inválido';
  }
}

// ── badges ───────────────────────────────────────────────

const FLOW_STATUS_TONE: Record<FlowStatus, string> = {
  DRAFT: TONE.neutral,
  PUBLISHED: TONE.ok,
  DEPRECATED: TONE.warn,
  THROTTLED: TONE.warn,
  BLOCKED: TONE.bad,
};

export function FlowStatusBadge({ status }: { status: string }) {
  // status desconhecido (a Meta pode criar novos) cai no tom neutro.
  const tone = FLOW_STATUS_TONE[status as FlowStatus] ?? TONE.neutral;
  return <Badge className={tone}>{status}</Badge>;
}

const SESSION_STATUS_TONE: Record<FlowSessionStatus, string> = {
  sent: TONE.info,
  in_progress: TONE.warn,
  completed: TONE.ok,
  failed: TONE.bad,
};

export function SessionStatusBadge({ status }: { status: string }) {
  const known = status as FlowSessionStatus;
  return (
    <Badge className={SESSION_STATUS_TONE[known] ?? TONE.neutral}>
      {SESSION_STATUS_LABEL[known] ?? status}
    </Badge>
  );
}

/** Badge genérico para valores de saúde/assinatura vindos da Meta (VALID, AVAILABLE, BLOCKED…). */
export function HealthBadge({ value }: { value: string }) {
  const v = value.toUpperCase();
  const tone =
    v === 'VALID' || v === 'AVAILABLE'
      ? TONE.ok
      : v === 'LIMITED' || v === 'THROTTLED'
        ? TONE.warn
        : v === 'BLOCKED' || v === 'MISMATCH'
          ? TONE.bad
          : TONE.neutral;
  return <Badge className={tone}>{value}</Badge>;
}

// ── peças pequenas ───────────────────────────────────────

export function CopyButton({ text, label = 'Copiar' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button type="button" variant="outline" size="sm" onClick={copy}>
      {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      {copied ? 'Copiado' : label}
    </Button>
  );
}

/** Valor copiável numa linha (rola na horizontal em vez de estourar a largura). */
export function CopyField({ value }: { value: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
      <code className="overflow-x-auto whitespace-nowrap rounded bg-muted px-2 py-1.5 text-xs">
        {value}
      </code>
      <CopyButton text={value} />
    </div>
  );
}

export function JsonBlock({ value, className }: { value: unknown; className?: string }) {
  return (
    <pre
      className={cn(
        'max-h-72 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-xs leading-relaxed',
        className,
      )}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="break-words text-xs text-destructive">{errorText(error)}</p>;
}

// ── validation_errors da Meta ────────────────────────────

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : undefined;

/** "linha 4, coluna 12" a partir dos campos soltos ou do primeiro `pointers[]`. */
function position(err: Record<string, unknown>): string | undefined {
  const pointers = Array.isArray(err.pointers) ? err.pointers.find(isRecord) : undefined;
  const src = pointers ?? err;
  const line = str(src.line_start);
  const col = str(src.column_start);
  const lineEnd = str(src.line_end);
  if (!line) return undefined;
  const lines = lineEnd && lineEnd !== line ? `linhas ${line}–${lineEnd}` : `linha ${line}`;
  return col ? `${lines}, coluna ${col}` : lines;
}

/**
 * Lista os `validation_errors` devolvidos pela Meta. O formato não é contratado
 * (`unknown[]`): mostra mensagem/tipo/posição quando existem e cai no JSON cru
 * para qualquer item fora do esperado.
 */
export function ValidationErrors({
  errors,
  okText = 'Sem erros de validação.',
}: {
  errors: unknown[] | undefined;
  okText?: string;
}) {
  if (!errors) return null;
  if (!errors.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-500">
        <CheckCircle2 className="size-3.5 shrink-0" /> {okText}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
        <AlertTriangle className="size-3.5 shrink-0" /> {errors.length} erro(s) de validação
      </p>
      <ul className="max-h-64 space-y-1.5 overflow-y-auto">
        {errors.map((raw, i) => {
          if (!isRecord(raw)) {
            return (
              <li key={i} className="rounded-md border border-amber-500/30 p-2 text-xs">
                <code className="break-all">
                  {typeof raw === 'string' ? raw : JSON.stringify(raw)}
                </code>
              </li>
            );
          }
          const message = str(raw.message);
          const type = str(raw.error) ?? str(raw.error_type);
          const pos = position(raw);
          return (
            <li key={i} className="space-y-1 rounded-md border border-amber-500/30 p-2 text-xs">
              {(type || pos) && (
                <div className="flex flex-wrap items-center gap-1.5">
                  {type && (
                    <Badge variant="outline" className="font-mono text-[10px]">
                      {type}
                    </Badge>
                  )}
                  {pos && <span className="text-muted-foreground">{pos}</span>}
                </div>
              )}
              {message ? (
                <p className="break-words">{message}</p>
              ) : (
                <code className="break-all">{JSON.stringify(raw)}</code>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── confirmação ──────────────────────────────────────────

interface ConfirmDialogProps {
  title: string;
  /** o que vai acontecer — obrigatório para ações irreversíveis. */
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  pending: boolean;
  error: unknown;
  onConfirm: () => void;
  onClose: () => void;
}

export function ConfirmDialog(p: ConfirmDialogProps) {
  return (
    <Dialog open onOpenChange={(open) => !open && !p.pending && p.onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">{p.children}</div>
          </DialogDescription>
        </DialogHeader>
        <ErrorNote error={p.error} />
        <DialogFooter>
          <Button variant="outline" onClick={p.onClose} disabled={p.pending}>
            Cancelar
          </Button>
          <Button
            variant={p.destructive ? 'destructive' : 'default'}
            onClick={p.onConfirm}
            disabled={p.pending}
          >
            {p.pending ? 'Aguarde…' : p.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
