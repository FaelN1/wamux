import { useState } from 'react';
import { KeyRound, Link2, RefreshCw, Save, Trash2 } from 'lucide-react';
import {
  useFlowEncryption,
  useFlowEndpoint,
  useSetFlowEncryption,
  useSetFlowEndpoint,
} from '@/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ConfirmDialog, CopyField, ErrorNote, HealthBadge, textareaCls } from './flow-ui';

/** Aba "Endpoint & criptografia": o que um Flow com troca de dados precisa. */
export function FlowEndpointSection({ instanceId }: { instanceId: string }) {
  return (
    <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
      <EndpointCard instanceId={instanceId} />
      <EncryptionCard instanceId={instanceId} />
    </div>
  );
}

// ── endpoint de troca de dados ───────────────────────────

function EndpointCard({ instanceId }: { instanceId: string }) {
  const endpoint = useFlowEndpoint(instanceId);
  const setEndpoint = useSetFlowEndpoint(instanceId);
  // null = ainda não editado → mostra a URL salva.
  const [draft, setDraft] = useState<string | null>(null);
  const saved = endpoint.data?.url ?? '';
  const value = draft ?? saved;
  const changed = value.trim() !== saved;

  const done = { onSuccess: () => setDraft(null) };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-primary" /> Endpoint de troca de dados
        </CardTitle>
        <CardDescription>
          O WhatsApp chama o gateway com o payload cifrado; o gateway decifra e repassa em JSON para
          o seu serviço, que responde com a próxima tela.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {endpoint.isLoading && <Skeleton className="h-24 w-full" />}
        {endpoint.isError && (
          <div className="space-y-2">
            <ErrorNote error={endpoint.error} />
            <Button variant="outline" size="sm" onClick={() => endpoint.refetch()}>
              Tentar de novo
            </Button>
          </div>
        )}

        {endpoint.data && (
          <>
            <div className="space-y-1.5">
              <Label>URL do gateway (endpointUri)</Label>
              {endpoint.data.endpointUri ? (
                <>
                  <CopyField value={endpoint.data.endpointUri} />
                  <p className="text-xs text-muted-foreground">
                    É este valor que vai no <code>endpoint_uri</code> do Flow (na criação ou no
                    editor, enquanto DRAFT).
                  </p>
                </>
              ) : (
                <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-500">
                  Indisponível: defina <code>PUBLIC_BASE_URL</code> (HTTPS público) no gateway para
                  que ele consiga montar a URL que vai no <code>endpoint_uri</code> do Flow.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fe-url">URL do seu serviço</Label>
              <Input
                id="fe-url"
                value={value}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="https://meu-app.com/whatsapp/flow"
              />
              <p className="text-xs text-muted-foreground">
                {saved
                  ? 'Recebe POST com instanceId, action, screen, data e flowToken.'
                  : 'Nenhum serviço configurado — Flows com endpoint falham até você definir um.'}
              </p>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button
                  onClick={() => setEndpoint.mutate(value.trim(), done)}
                  disabled={!changed || !value.trim() || setEndpoint.isPending}
                >
                  <Save /> {setEndpoint.isPending ? 'Salvando…' : 'Salvar'}
                </Button>
                {saved && (
                  <Button
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={setEndpoint.isPending}
                    onClick={() => {
                      if (confirm('Remover a URL do seu serviço? Flows com endpoint vão falhar.'))
                        setEndpoint.mutate(null, done);
                    }}
                  >
                    <Trash2 /> Remover
                  </Button>
                )}
              </div>
              {setEndpoint.isSuccess && !changed && (
                <p className="text-xs text-emerald-500">Endpoint atualizado.</p>
              )}
              <ErrorNote error={setEndpoint.error} />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

// ── criptografia ─────────────────────────────────────────

function EncryptionCard({ instanceId }: { instanceId: string }) {
  const encryption = useFlowEncryption(instanceId);
  const setEncryption = useSetFlowEncryption(instanceId);
  const [confirming, setConfirming] = useState(false);
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const info = encryption.data;
  const sigStatus = info?.business_public_key_signature_status;
  const hasKey = !!info?.hasPrivateKey || !!info?.business_public_key;

  const generate = () => {
    setEncryption.reset();
    if (hasKey) setConfirming(true);
    else setEncryption.mutate({});
  };

  const importKey = () => {
    if (
      hasKey &&
      !confirm('Importar esta chave substitui a chave atual registrada na Meta. Continuar?')
    )
      return;
    setEncryption.mutate(
      { privateKey: privateKey.trim(), ...(passphrase ? { passphrase } : {}) },
      {
        onSuccess: () => {
          setPrivateKey('');
          setPassphrase('');
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <KeyRound className="size-4 text-primary" /> Criptografia
        </CardTitle>
        <CardDescription>
          Par de chaves RSA do número. A pública fica registrada na Meta; a privada fica só no
          gateway e nunca é devolvida pela API.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {encryption.isLoading && <Skeleton className="h-24 w-full" />}
        {encryption.isError && (
          <div className="space-y-2">
            <ErrorNote error={encryption.error} />
            <Button variant="outline" size="sm" onClick={() => encryption.refetch()}>
              Tentar de novo
            </Button>
          </div>
        )}

        {info && (
          <>
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-muted-foreground">Assinatura da chave pública na Meta</dt>
                <dd>
                  {sigStatus ? (
                    <HealthBadge value={sigStatus} />
                  ) : (
                    <Badge variant="muted">não registrada</Badge>
                  )}
                </dd>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-muted-foreground">Chave privada no gateway</dt>
                <dd>
                  <Badge
                    className={cn(
                      info.hasPrivateKey
                        ? 'bg-emerald-500/15 text-emerald-500'
                        : 'bg-red-500/15 text-red-500',
                    )}
                  >
                    {info.hasPrivateKey ? 'guardada' : 'ausente'}
                  </Badge>
                </dd>
              </div>
            </dl>

            {sigStatus === 'MISMATCH' && (
              <p className="text-xs text-amber-500">
                A chave registrada na Meta não confere — gere um novo par para corrigir.
              </p>
            )}
            {!info.hasPrivateKey && info.business_public_key && (
              <p className="text-xs text-amber-500">
                Há uma chave pública na Meta, mas o gateway não tem a privada correspondente: ele
                não consegue decifrar as chamadas. Gere um novo par ou importe a sua privada.
              </p>
            )}

            {info.business_public_key && (
              <details>
                <summary className="cursor-pointer text-xs text-muted-foreground">
                  Ver chave pública
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-muted/50 p-3 font-mono text-[11px]">
                  {info.business_public_key}
                </pre>
              </details>
            )}

            <div className="space-y-2">
              <Button variant="outline" onClick={generate} disabled={setEncryption.isPending}>
                <RefreshCw className={cn(setEncryption.isPending && 'animate-spin')} />
                {hasKey ? 'Gerar novo par de chaves' : 'Gerar par de chaves'}
              </Button>
              {setEncryption.isSuccess && (
                <p className="text-xs text-emerald-500">Chave registrada na Meta.</p>
              )}
              {!confirming && <ErrorNote error={setEncryption.error} />}
            </div>

            <details className="rounded-md border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Avançado: importar a minha chave privada
              </summary>
              <div className="mt-3 space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fe-private-key">Chave privada RSA (PEM, ≥ 2048 bits)</Label>
                  <textarea
                    id="fe-private-key"
                    value={privateKey}
                    onChange={(e) => setPrivateKey(e.target.value)}
                    rows={5}
                    spellCheck={false}
                    autoComplete="off"
                    className={cn(textareaCls, 'font-mono text-xs')}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fe-passphrase">Senha da chave (se for cifrada)</Label>
                  <Input
                    id="fe-passphrase"
                    type="password"
                    autoComplete="off"
                    value={passphrase}
                    onChange={(e) => setPassphrase(e.target.value)}
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={importKey}
                  disabled={privateKey.trim().length < 64 || setEncryption.isPending}
                >
                  Importar e registrar
                </Button>
              </div>
            </details>
          </>
        )}
      </CardContent>

      {confirming && (
        <ConfirmDialog
          title="Gerar novo par de chaves?"
          confirmLabel="Gerar e substituir"
          destructive
          pending={setEncryption.isPending}
          error={setEncryption.error}
          onClose={() => setConfirming(false)}
          onConfirm={() => setEncryption.mutate({}, { onSuccess: () => setConfirming(false) })}
        >
          <p>
            A chave atual é <b>substituída</b>: a nova pública é registrada na Meta e a privada
            antiga é descartada, sem como recuperar.
          </p>
          <p>
            Sessões de Flow abertas com a chave antiga deixam de ser decifradas; o app do usuário
            recarrega a chave e tenta de novo.
          </p>
        </ConfirmDialog>
      )}
    </Card>
  );
}
