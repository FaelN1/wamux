import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock,
  FileText,
  Loader2,
  Mic,
  Paperclip,
  Search,
  Send,
  Trash2,
  WifiOff,
  X,
} from 'lucide-react';
import {
  EMPTY_EVENTS_CONFIG,
  MessageAckStatus,
  MessageType,
  type ChatMessage,
  type ChatSummary,
} from '@wamux/shared';
import {
  useChatMessages,
  useChats,
  useInstances,
  useMarkChatRead,
  useSendMedia,
  useSendText,
  useSetEvents,
} from '@/api';
import { useInboxSocket } from '@/hooks/useInboxSocket';
import { isRecordingSupported, useAudioRecorder } from '@/hooks/useAudioRecorder';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

/** Tipo aceito por `POST /messages/:id/media` — derivado do MIME do arquivo escolhido. */
function mediaKindFromMime(mimetype: string): 'image' | 'video' | 'audio' | 'document' {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
}

/** `File` é um `Blob`, então serve tanto pro anexo quanto pra gravação. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(((reader.result as string) || '').split(',')[1] ?? '');
    reader.onerror = () => reject(reader.error ?? new Error('Falha ao ler o arquivo'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Mídia de verdade na thread — antes só tentava `<img>` pra QUALQUER tipo
 * (achado em QA: vídeo/áudio/documento nunca renderizavam, só imagem por
 * acaso funcionava). `mediaUrl` vem de `storeMediaBody` (inbound) ou do
 * `MediaService.prepareOutbound` (outbound — ver `messaging.service.ts`).
 */
function MediaBubble({ m }: { m: ChatMessage }) {
  if (!m.mediaUrl) return null;
  if (m.type === MessageType.IMAGE || m.type === MessageType.STICKER) {
    return (
      <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="mb-1 block">
        <img src={m.mediaUrl} alt="" className="max-h-64 rounded object-cover" />
      </a>
    );
  }
  if (m.type === MessageType.VIDEO) {
    return <video src={m.mediaUrl} controls className="mb-1 max-h-64 w-full rounded" />;
  }
  if (m.type === MessageType.AUDIO) {
    return <audio src={m.mediaUrl} controls className="mb-1 w-64 max-w-full" />;
  }
  if (m.type === MessageType.DOCUMENT) {
    return (
      <a
        href={m.mediaUrl}
        target="_blank"
        rel="noreferrer"
        className="mb-1 flex items-center gap-2 rounded bg-background/40 p-2"
      >
        <FileText className="size-5 shrink-0" />
        <span className="truncate text-xs underline">{m.mediaFilename || 'Documento'}</span>
      </a>
    );
  }
  return null;
}

const REALTIME_EVENTS = new Set([
  'message.received',
  'message.sent',
  'message.status',
  // Sem isto a reação só apareceria no próximo refresh manual: ela chega como
  // evento próprio, não como mensagem nova.
  'message.reaction',
]);

/**
 * Submenus do Inbox → `ChatType` mandado para `GET /instances/:id/chats?type=`.
 * A rota sem `scope` (`/inbox`) não manda `type` e reúne tudo, inclusive
 * `broadcast`, que não tem submenu próprio.
 */
const INBOX_SCOPES = {
  chats: { type: 'user', label: 'Chats', empty: 'Nenhuma conversa individual' },
  groups: { type: 'group', label: 'Grupos', empty: 'Nenhum grupo' },
  newsletters: { type: 'newsletter', label: 'Canais', empty: 'Nenhum canal' },
} as const;

type InboxScope = keyof typeof INBOX_SCOPES;

function initials(name: string): string {
  return name.replace(/@.*/, '').slice(0, 2).toUpperCase();
}

/**
 * BUG REAL achado em QA: `avatarUrl` já vinha certo da API (o
 * `getContactAvatar`/refetch lazy funciona), mas o painel nunca lia esse
 * campo em lugar nenhum — só mostrava as iniciais sempre. `<img>` com
 * fallback pras iniciais quando não tem foto (ou a imagem falha ao carregar).
 */
function Avatar({
  name,
  avatarUrl,
  className,
}: {
  name: string;
  avatarUrl?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (avatarUrl && !failed) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className={cn('shrink-0 rounded-full object-cover', className)}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary',
        className,
      )}
    >
      {initials(name)}
    </div>
  );
}

function AckIcon({ ack }: { ack?: MessageAckStatus }) {
  if (!ack || ack === MessageAckStatus.PENDING) return <Clock className="size-3.5" />;
  if (ack === MessageAckStatus.FAILED)
    return <AlertTriangle className="size-3.5 text-destructive" />;
  if (ack === MessageAckStatus.READ || ack === MessageAckStatus.PLAYED) {
    return <CheckCheck className="size-3.5 text-primary" />;
  }
  if (ack === MessageAckStatus.DELIVERED) return <CheckCheck className="size-3.5" />;
  return <Check className="size-3.5" />;
}

/**
 * Identidade do dia no fuso LOCAL. Usar `toISOString()` aqui daria o dia em
 * UTC e trocaria a divisória de lugar para quem está a oeste de Greenwich —
 * uma mensagem das 22h de BRT cairia no dia seguinte.
 */
function dayKey(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Meia-noite local — base para contar a diferença em dias de CALENDÁRIO. */
function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/**
 * Rótulo da divisória, na escada do WhatsApp: Hoje → Ontem → dia da semana
 * (última semana) → data cheia. A diferença é contada em dias de calendário,
 * não em 24h corridas: às 00h30, uma mensagem das 23h de ontem tem 1h30 de
 * idade mas é "Ontem", não "Hoje".
 */
function dayLabel(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  if (diffDays === 0) return 'Hoje';
  if (diffDays === 1) return 'Ontem';
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString('pt-BR', { weekday: 'long' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
}

function DaySeparator({ timestamp }: { timestamp: number }) {
  return (
    <div className="flex justify-center py-1.5">
      <span className="rounded-full bg-muted px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground shadow-sm">
        {dayLabel(timestamp)}
      </span>
    </div>
  );
}

/** mm:ss do contador de gravação. */
function durationLabel(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function timeLabel(unixSeconds?: number): string {
  if (!unixSeconds) return '';
  return new Date(unixSeconds * 1000).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function InboxPage() {
  const { scope } = useParams<{ scope?: string }>();
  const activeScope = scope && scope in INBOX_SCOPES ? INBOX_SCOPES[scope as InboxScope] : null;
  const { data: instances } = useInstances();
  const [instanceId, setInstanceId] = useState('');
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState('');
  const [wsReconnectKey, setWsReconnectKey] = useState(0);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);
  const [attachedPreviewUrl, setAttachedPreviewUrl] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const qc = useQueryClient();
  const recorder = useAudioRecorder();
  // Constante durante a sessão (depende do contexto seguro e das APIs do
  // navegador), então não precisa de estado nem de efeito.
  const recordingSupported = isRecordingSupported();
  const threadRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Default: primeira instância conectada; senão a primeira da lista.
  useEffect(() => {
    if (instanceId || !instances?.length) return;
    setInstanceId((instances.find((i) => i.status === 'connected') ?? instances[0]).id);
  }, [instances, instanceId]);

  // A conversa aberta pode não existir no novo escopo (ex.: sai de Grupos para
  // Canais), então a seleção é descartada junto com a troca de submenu.
  useEffect(() => {
    setSelectedJid(null);
  }, [scope]);

  const chats = useChats(instanceId || null, {
    q: search || undefined,
    type: activeScope?.type,
  });
  const messages = useChatMessages(instanceId || null, selectedJid);
  const markRead = useMarkChatRead();
  const sendText = useSendText();
  const sendMedia = useSendMedia();
  const setEvents = useSetEvents();

  const { connected: wsConnected } = useInboxSocket(
    instanceId || null,
    (event) => {
      if (!REALTIME_EVENTS.has(event)) return;
      void qc.invalidateQueries({ queryKey: ['inbox-chats', instanceId] });
      if (selectedJid)
        void qc.invalidateQueries({ queryKey: ['inbox-messages', instanceId, selectedJid] });
    },
    wsReconnectKey,
  );

  // Bug de UX achado em QA: a thread abria no topo (mensagem mais antiga da
  // página) em vez de rolar pra mensagem mais recente, como qualquer app de
  // chat. Rola pro fim sempre que troca de conversa OU a página de mensagens
  // muda (nova mensagem chegou/foi enviada).
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [selectedJid, messages.data]);

  const selectedInstance = instances?.find((i) => i.id === instanceId);

  /** Mesmo endpoint que a tela de Configurações usa — só liga o `websocket`, preserva webhook/rabbitmq. */
  const enableRealtime = () => {
    if (!instanceId || !selectedInstance) return;
    const e = selectedInstance.events;
    setEvents.mutate(
      {
        id: instanceId,
        config: {
          webhook: e?.webhook ?? { ...EMPTY_EVENTS_CONFIG.webhook },
          websocket: { ...(e?.websocket ?? EMPTY_EVENTS_CONFIG.websocket), enabled: true },
          rabbitmq: e?.rabbitmq ?? { ...EMPTY_EVENTS_CONFIG.rabbitmq },
        },
      },
      { onSuccess: () => setWsReconnectKey((k) => k + 1) },
    );
  };

  const selectChat = (chat: ChatSummary) => {
    clearAttachment();
    setSendError(null);
    setSelectedJid(chat.jid);
    if (instanceId && chat.unreadCount > 0) markRead.mutate({ id: instanceId, jid: chat.jid });
  };

  function clearAttachment() {
    setAttachedPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setAttachedFile(null);
  }

  const onFileSelected = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo de novo depois
    if (!file) return;
    clearAttachment();
    setAttachedFile(file);
    setAttachedPreviewUrl(URL.createObjectURL(file));
  };

  const invalidateThread = () => {
    void qc.invalidateQueries({ queryKey: ['inbox-chats', instanceId] });
    void qc.invalidateQueries({ queryKey: ['inbox-messages', instanceId, selectedJid] });
  };

  /**
   * Encerra a gravação e envia como nota de voz. `asPtt` faz a API converter
   * para ogg/opus antes de entregar ao engine — o navegador grava em webm no
   * Chrome, e o WhatsApp só toca nota de voz em ogg/opus.
   */
  const sendRecording = async () => {
    if (!instanceId || !selectedJid) return;
    setSendError(null);
    const audio = await recorder.stop();
    if (!audio) return; // cancelou ou não capturou nada
    try {
      const base64 = await blobToBase64(audio.blob);
      sendMedia.mutate(
        {
          id: instanceId,
          to: selectedJid,
          type: 'audio',
          base64,
          filename: 'nota-de-voz.ogg',
          mimetype: audio.mimetype,
          asPtt: true,
        },
        { onSuccess: invalidateThread, onError: (err) => setSendError((err as Error).message) },
      );
    } catch (err) {
      setSendError((err as Error).message);
    }
  };

  const send = async () => {
    if (!instanceId || !selectedJid) return;
    setSendError(null);
    const text = draft.trim();

    if (attachedFile) {
      const file = attachedFile;
      setDraft('');
      clearAttachment();
      try {
        const base64 = await blobToBase64(file);
        sendMedia.mutate(
          {
            id: instanceId,
            to: selectedJid,
            type: mediaKindFromMime(file.type),
            base64,
            filename: file.name,
            mimetype: file.type || undefined,
            caption: text || undefined,
          },
          { onSuccess: invalidateThread, onError: (err) => setSendError((err as Error).message) },
        );
      } catch (err) {
        setSendError((err as Error).message);
      }
      return;
    }

    if (!text) return;
    setDraft('');
    sendText.mutate({ id: instanceId, to: selectedJid, text }, { onSuccess: invalidateThread });
  };

  const selectedChat = chats.data?.items.find((c) => c.jid === selectedJid);
  const items = chats.data?.items ?? [];
  // Canal é difusão: todo mundo lê a mesma publicação, não há "eu à direita,
  // ele à esquerda". Por isso a thread vira uma coluna central única, como o
  // WhatsApp faz em Canais.
  const isNewsletter = selectedChat?.type === 'newsletter';
  // A API devolve "mais recente primeiro"; a thread lê de cima pra baixo. O
  // `reverse()` muta o array, então copia antes — sem isso a lista do cache do
  // React Query seria invertida a cada render.
  const orderedMessages = useMemo(
    () => [...(messages.data?.items ?? [])].reverse(),
    [messages.data],
  );

  return (
    <div className="flex h-[calc(100vh-8.5rem)] flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-display text-sm font-semibold">
          Inbox
          <span className="text-muted-foreground"> · {activeScope?.label ?? 'Tudo'}</span>
        </h1>
        <select
          value={instanceId}
          onChange={(e) => {
            setInstanceId(e.target.value);
            setSelectedJid(null);
          }}
          className="h-9 rounded-md border border-input bg-transparent px-2 text-sm"
        >
          <option value="">— selecione uma instância —</option>
          {(instances ?? []).map((i) => (
            <option key={i.id} value={i.id}>
              {i.name} ({i.provider}, {i.status})
            </option>
          ))}
        </select>
        {instanceId && (
          <Badge variant={wsConnected ? 'default' : 'muted'} className="gap-1">
            {wsConnected ? <CheckCheck className="size-3" /> : <WifiOff className="size-3" />}
            {wsConnected ? 'Tempo real ativo' : 'Sem tempo real'}
          </Badge>
        )}
        {!wsConnected && instanceId && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch
              checked={false}
              disabled={setEvents.isPending}
              onCheckedChange={enableRealtime}
              aria-label="Ligar tempo real"
            />
            <span>
              {setEvents.isPending
                ? 'Ligando…'
                : 'ligar tempo real — a lista e a thread continuam funcionando sem isso, só não atualizam sozinhas.'}
            </span>
          </div>
        )}
      </div>

      {!instanceId ? (
        <EmptyState
          title="Escolha uma instância"
          description="Selecione uma instância acima pra ver o Inbox."
        />
      ) : (
        <div className="flex flex-1 gap-3 overflow-hidden rounded-lg border">
          {/* Conversations */}
          <div className="flex w-80 shrink-0 flex-col border-r">
            <div className="border-b p-2">
              <div className="relative">
                <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar por nome/número…"
                  className="pl-8"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {chats.isLoading ? (
                <div className="space-y-2 p-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-14 w-full" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  className="p-6"
                  title={activeScope?.empty ?? 'Nenhuma conversa'}
                  description={
                    search
                      ? 'Nada encontrado para essa busca neste submenu.'
                      : 'Sem conversas persistidas — confira se DATABASE_SAVE_DATA_CONTACTS está ligado, ou aguarde uma mensagem nova.'
                  }
                />
              ) : (
                items.map((chat) => (
                  <button
                    key={chat.jid}
                    onClick={() => selectChat(chat)}
                    className={cn(
                      'flex w-full items-center gap-3 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/50',
                      selectedJid === chat.jid && 'bg-muted',
                    )}
                  >
                    <Avatar name={chat.name} avatarUrl={chat.avatarUrl} className="size-9" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium">{chat.name}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {timeLabel(chat.lastMessageAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        {chat.lastMessageFromMe && <AckIcon ack={chat.lastMessageAck} />}
                        <span className="truncate">{chat.lastMessageText || '—'}</span>
                      </div>
                    </div>
                    {chat.unreadCount > 0 && (
                      <Badge className="shrink-0 rounded-full px-1.5">{chat.unreadCount}</Badge>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Thread + Composer */}
          <div className="flex flex-1 flex-col">
            {!selectedJid ? (
              <EmptyState
                title="Selecione uma conversa"
                description="Escolha um chat na lista à esquerda."
              />
            ) : (
              <>
                <div className="flex items-center gap-3 border-b p-3">
                  <Avatar
                    name={selectedChat?.name ?? selectedJid}
                    avatarUrl={selectedChat?.avatarUrl}
                    className="size-8"
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {selectedChat?.name ?? selectedJid}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{selectedJid}</div>
                  </div>
                </div>
                <div ref={threadRef} className="flex-1 space-y-2 overflow-y-auto p-3">
                  {messages.isLoading ? (
                    <div className="space-y-2">
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-2/3" />
                      ))}
                    </div>
                  ) : !messages.data?.items.length ? (
                    <EmptyState
                      title="Sem mensagens persistidas"
                      description="Confira se DATABASE_SAVE_DATA_NEW_MESSAGE está ligado — sem ele, o histórico da thread não é gravado."
                    />
                  ) : (
                    orderedMessages.map((m, i) => {
                      // Pedido de UX (bug #4): em grupo, mostra de quem é
                      // cada mensagem recebida (foto + nome), igual ao app
                      // oficial — em DM seria repetitivo (é sempre a mesma
                      // pessoa), por isso só quando `type === 'group'`.
                      const showSender = selectedChat?.type === 'group' && !m.fromMe;
                      // Divisória de dia: primeira mensagem com data, ou
                      // virada de dia em relação à anterior. Mensagem sem
                      // timestamp (0) não abre divisória — viraria "1970".
                      const prev = orderedMessages[i - 1];
                      const showDay =
                        !!m.timestamp &&
                        (!prev?.timestamp || dayKey(prev.timestamp) !== dayKey(m.timestamp));
                      return (
                        <Fragment key={m.id}>
                          {showDay && <DaySeparator timestamp={m.timestamp} />}
                          <div
                            className={cn(
                              'flex items-end gap-2',
                              isNewsletter
                                ? 'justify-center'
                                : m.fromMe
                                  ? 'justify-end'
                                  : 'justify-start',
                            )}
                          >
                            {showSender && (
                              <Avatar
                                name={m.pushName || m.senderId || '?'}
                                avatarUrl={m.senderAvatarUrl}
                                className="size-6"
                              />
                            )}
                            <div
                              className={cn(
                                'rounded-lg px-3 py-2 text-sm',
                                isNewsletter
                                  ? 'w-full max-w-xl bg-muted'
                                  : cn(
                                      'max-w-[70%]',
                                      m.fromMe ? 'bg-primary text-primary-foreground' : 'bg-muted',
                                    ),
                              )}
                            >
                              {showSender && (m.pushName || m.senderId) && (
                                <div className="mb-0.5 truncate text-xs font-semibold text-primary">
                                  {m.pushName || m.senderId}
                                </div>
                              )}
                              <MediaBubble m={m} />
                              {(m.text || m.mediaCaption || !m.mediaUrl) && (
                                <div className="whitespace-pre-wrap break-words">
                                  {m.text || m.mediaCaption || `[${m.type}]`}
                                </div>
                              )}
                              {m.reaction && (
                                <div
                                  className={cn(
                                    'mt-1 flex',
                                    !isNewsletter && m.fromMe ? 'justify-end' : 'justify-start',
                                  )}
                                >
                                  <span className="rounded-full border bg-background px-1.5 py-0.5 text-xs leading-none shadow-sm">
                                    {m.reaction}
                                  </span>
                                </div>
                              )}
                              <div className="mt-1 flex items-center justify-end gap-1 text-[10px] opacity-70">
                                {timeLabel(m.timestamp)}
                                {m.fromMe && <AckIcon ack={m.ack} />}
                              </div>
                            </div>
                          </div>
                        </Fragment>
                      );
                    })
                  )}
                </div>
                {attachedFile && (
                  <div className="flex items-center gap-2 border-t bg-muted/30 px-3 py-2">
                    {attachedFile.type.startsWith('image/') && attachedPreviewUrl ? (
                      <img
                        src={attachedPreviewUrl}
                        alt=""
                        className="size-10 rounded object-cover"
                      />
                    ) : (
                      <FileText className="size-6 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                      {attachedFile.name}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-7"
                      onClick={clearAttachment}
                    >
                      <X className="size-4" />
                    </Button>
                  </div>
                )}
                {sendError && (
                  <p className="border-t bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                    {sendError}
                  </p>
                )}
                <div className="flex items-center gap-2 border-t p-3">
                  <input ref={fileInputRef} type="file" hidden onChange={onFileSelected} />
                  {recorder.state === 'idle' ? (
                    <>
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={sendMedia.isPending}
                        title="Anexar imagem, vídeo, áudio ou documento"
                      >
                        <Paperclip className="size-4" />
                      </Button>
                      <Input
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && send()}
                        placeholder={attachedFile ? 'Legenda (opcional)…' : 'Escreva uma mensagem…'}
                      />
                      {/* Microfone quando não há nada a enviar, botão de envio
                          quando há — mesma troca do app oficial. */}
                      {draft.trim() || attachedFile ? (
                        <Button
                          size="icon"
                          onClick={send}
                          disabled={sendText.isPending || sendMedia.isPending}
                        >
                          {sendMedia.isPending ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Send className="size-4" />
                          )}
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          variant="outline"
                          onClick={() => void recorder.start()}
                          disabled={sendMedia.isPending || !recordingSupported}
                          title={
                            recordingSupported
                              ? 'Gravar nota de voz'
                              : 'Gravação exige https ou localhost'
                          }
                        >
                          <Mic className="size-4" />
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={recorder.cancel}
                        title="Descartar gravação"
                      >
                        <Trash2 className="size-4 text-destructive" />
                      </Button>
                      <div className="flex flex-1 items-center gap-2 text-sm">
                        <span className="size-2 animate-pulse rounded-full bg-destructive" />
                        <span className="tabular-nums">{durationLabel(recorder.seconds)}</span>
                        <span className="text-xs text-muted-foreground">gravando nota de voz…</span>
                      </div>
                      <Button
                        size="icon"
                        onClick={sendRecording}
                        disabled={recorder.state === 'stopping' || sendMedia.isPending}
                      >
                        {recorder.state === 'stopping' || sendMedia.isPending ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Send className="size-4" />
                        )}
                      </Button>
                    </>
                  )}
                </div>
                {recorder.error && (
                  <p className="border-t bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                    {recorder.error}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-1 flex-col items-center justify-center gap-1 text-center',
        className,
      )}
    >
      <X className="mb-1 size-6 text-muted-foreground/50" />
      <p className="text-sm font-medium">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
