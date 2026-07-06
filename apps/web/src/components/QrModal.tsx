import { useEffect } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';
import { Instance, useConnect, useQr } from '../api';
import { Button, Modal, StatusBadge } from '../ui';

export function QrModal({ instance, onClose }: { instance: Instance; onClose: () => void }) {
  const connect = useConnect();
  const { data: qr, isFetching } = useQr(instance.id, true);

  // Ao abrir, dispara a conexão (gera o QR / restaura a sessão).
  useEffect(() => {
    connect.mutate(instance.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance.id]);

  const connected = (instance.liveStatus ?? instance.status) === 'connected';

  return (
    <Modal title={`Conectar — ${instance.name}`} onClose={onClose}>
      <div className="flex flex-col items-center gap-4">
        {connected ? (
          <div className="flex flex-col items-center gap-2 py-8 text-green-400">
            <CheckCircle2 className="h-12 w-12" />
            <p className="text-sm">Conectado!</p>
          </div>
        ) : qr?.qrImage ? (
          <>
            <img src={qr.qrImage} alt="QR Code" className="h-56 w-56 rounded-lg bg-white p-2" />
            <p className="text-center text-xs text-slate-400">
              Abra o WhatsApp → <b>Aparelhos conectados</b> → <b>Conectar um aparelho</b> e escaneie.
              <br />O código atualiza sozinho.
            </p>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
            <Loader2 className="h-8 w-8 animate-spin" />
            <p className="text-sm">{qr?.message ?? 'Gerando QR…'}</p>
          </div>
        )}
        <div className="flex items-center gap-2 text-xs text-slate-500">
          status: <StatusBadge status={instance.liveStatus ?? instance.status} />
          {isFetching && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
        <Button variant="ghost" className="w-full" onClick={onClose}>
          Fechar
        </Button>
      </div>
    </Modal>
  );
}
