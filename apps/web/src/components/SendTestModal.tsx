import { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { Instance, useSendText } from '../api';
import { Button, Field, Input, Modal } from '../ui';

export function SendTestModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const send = useSendText();
  const [to, setTo] = useState('');
  const [text, setText] = useState('Olá do WAMux! 🚀');
  const [result, setResult] = useState<string | null>(null);
  const [err, setErr] = useState('');

  const submit = () => {
    setErr('');
    setResult(null);
    send.mutate(
      { id: instance.id, to: to.trim(), text },
      {
        onSuccess: (r) => setResult(JSON.stringify(r)),
        onError: (e) => setErr((e as Error).message),
      },
    );
  };

  return (
    <Modal title={`Enviar teste — ${instance.name}`} onClose={onClose}>
      <Field label="Para (número com DDI)" hint="ex.: 5511999999999">
        <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="5511999999999" autoFocus />
      </Field>
      <Field label="Mensagem">
        <Input value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      {err && <p className="text-xs text-red-400">{err}</p>}
      {result && (
        <div className="flex items-start gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-2 text-xs text-green-300">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <code className="break-all">{result}</code>
        </div>
      )}
      <Button className="w-full" loading={send.isPending} disabled={!to.trim() || !text.trim()} onClick={submit}>
        Enviar
      </Button>
    </Modal>
  );
}
