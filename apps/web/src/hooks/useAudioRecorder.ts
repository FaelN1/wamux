import { useCallback, useEffect, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'recording' | 'stopping';

export interface RecordedAudio {
  blob: Blob;
  mimetype: string;
  /** duração em segundos, arredondada. */
  seconds: number;
}

/**
 * Gravação de nota de voz pelo navegador (`MediaRecorder`).
 *
 * O formato é escolhido pelo navegador, não por nós: o Chrome só grava
 * `audio/webm;codecs=opus` e o Firefox prefere `audio/ogg`. Quem uniformiza
 * é a API, que converte para ogg/opus quando `asPtt` — ver
 * `apps/api/src/media/audio-transcode.util.ts`. Aqui só reportamos o mimetype
 * real para que o servidor saiba o que recebeu.
 */
const PREFERRED_MIME_TYPES = [
  'audio/ogg;codecs=opus',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
];

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  return PREFERRED_MIME_TYPES.find((t) => MediaRecorder.isTypeSupported(t));
}

/**
 * `getUserMedia` só existe em contexto seguro (https ou localhost). Acessando
 * o painel por IP da rede em http, a API simplesmente não está no navegador —
 * daí checar a existência em vez de deixar estourar no clique.
 */
export function isRecordingSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}

export function useAudioRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Duração também em ref: o handler `onstop` é criado dentro de `start` e
  // enxergaria o `seconds` congelado em 0 do closure. Manter em ref evita
  // isso sem colocar `seconds` nas dependências (o que recriaria `start` a
  // cada tique do contador).
  const startedAtRef = useRef(0);
  // A Promise só resolve no evento `stop`, que é assíncrono — guardamos o
  // resolve para o `stop()` poder devolver o áudio já finalizado.
  const resolveRef = useRef<((r: RecordedAudio | null) => void) | null>(null);

  const cleanup = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop()); // libera o indicador de microfone
    streamRef.current = null;
    recorderRef.current = null;
    chunksRef.current = [];
  }, []);

  // Desmontar no meio da gravação não pode deixar o microfone aberto.
  useEffect(() => () => cleanup(), [cleanup]);

  const start = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!isRecordingSupported()) {
      setError('Seu navegador não permite gravar aqui (precisa de https ou localhost).');
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickMimeType();
      const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const type = rec.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const elapsed = Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000));
        resolveRef.current?.(blob.size > 0 ? { blob, mimetype: type, seconds: elapsed } : null);
        resolveRef.current = null;
        cleanup();
        setState('idle');
        setSeconds(0);
      };
      streamRef.current = stream;
      recorderRef.current = rec;
      rec.start();
      startedAtRef.current = Date.now();
      setSeconds(0);
      setState('recording');
      tickRef.current = setInterval(() => setSeconds((s) => s + 1), 1000);
      return true;
    } catch (e) {
      const err = e as Error;
      setError(
        err.name === 'NotAllowedError'
          ? 'Permissão de microfone negada.'
          : `Não foi possível acessar o microfone: ${err.message}`,
      );
      cleanup();
      setState('idle');
      return false;
    }
  }, [cleanup]);

  /** Encerra e devolve o áudio; `null` se não houver nada gravado. */
  const stop = useCallback((): Promise<RecordedAudio | null> => {
    const rec = recorderRef.current;
    if (!rec || rec.state === 'inactive') return Promise.resolve(null);
    setState('stopping');
    if (tickRef.current) clearInterval(tickRef.current);
    return new Promise<RecordedAudio | null>((resolve) => {
      resolveRef.current = resolve;
      rec.stop();
    });
  }, []);

  /** Descarta a gravação em curso sem produzir áudio. */
  const cancel = useCallback(() => {
    const rec = recorderRef.current;
    resolveRef.current = null;
    if (rec && rec.state !== 'inactive') {
      rec.onstop = null;
      rec.stop();
    }
    cleanup();
    setState('idle');
    setSeconds(0);
  }, [cleanup]);

  return { state, seconds, error, start, stop, cancel, setError };
}
