import { useEffect, useRef, useState } from 'react';
import { getApiKey } from '@/api';

/**
 * Cliente WS pro `EventsWsGateway` (`/events?instance=…&apikey=…`) — tempo
 * real do Inbox (`message.received`/`message.sent`/`message.status`), sem
 * polling. Reconecta com backoff fixo; se o servidor fechar com 4003
 * ("WebSocket desabilitado nesta instância" — `events.websocket.enabled`
 * off no painel de Configurações da instância), NÃO fica tentando de novo
 * pra sempre — só reporta `connected: false` e o Inbox segue funcionando
 * sem tempo real (invalidação manual/refresh continua disponível).
 */
export function useInboxSocket(
  instanceId: string | null,
  onEvent: (event: string, data: unknown) => void,
  /** Muda esse valor pra forçar uma reconexão (ex.: acabou de ligar o WebSocket da instância). */
  reconnectKey: number | string = 0,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!instanceId) return;
    const id = instanceId;
    let closed = false;
    let ws: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/events?instance=${encodeURIComponent(id)}&apikey=${encodeURIComponent(getApiKey())}`;
      const socket = new WebSocket(url);
      ws = socket;

      socket.onopen = () => setConnected(true);

      socket.onclose = (ev) => {
        setConnected(false);
        // 4003 = websocket desabilitado nessa instância; 4001/4004 = apikey/
        // instância inválida — nenhum dos três se resolve tentando de novo.
        const terminal = ev.code === 4001 || ev.code === 4003 || ev.code === 4004;
        if (!closed && !terminal) retryTimer = setTimeout(connect, 5000);
      };

      socket.onerror = () => socket.close();

      socket.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { event?: string; data?: unknown };
          if (msg.event && msg.event !== 'ws.connected') onEventRef.current(msg.event, msg.data);
        } catch {
          // payload inesperado — ignora, não derruba a conexão.
        }
      };
    }
    connect();

    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
    };
  }, [instanceId, reconnectKey]);

  return { connected };
}
