import { useEffect, useRef, useState } from 'react';
import { getApiKey } from '@/api';

/**
 * Cliente WS pro canal ADMIN do `EventsWsGateway` (`/events?apikey=…`, SEM
 * `instance` — ver `docs/logs-painel-handoff.md` §6) — tempo real do painel
 * de Logs, todas as instâncias de uma vez. Espelha `useInboxSocket`, só
 * troca a query string de conexão e é gated por um `enabled` (o toggle
 * "Live" da tela) em vez de um `instanceId`.
 */
export function useActivityLogSocket(
  enabled: boolean,
  onEvent: (event: string, data: unknown) => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    let ws: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      if (closed) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/events?apikey=${encodeURIComponent(getApiKey())}`;
      const socket = new WebSocket(url);
      ws = socket;

      socket.onopen = () => setConnected(true);

      socket.onclose = (ev) => {
        setConnected(false);
        // 4001 = apikey inválida — não se resolve tentando de novo.
        const terminal = ev.code === 4001;
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
  }, [enabled]);

  return { connected };
}
