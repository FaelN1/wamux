/**
 * Chamadas de voz REAIS (VoIP), gated por `capabilities.voiceCalls`.
 *
 * Não confundir com `calling.ts`: aquele é a Calling API da Cloud (Meta), que
 * só fala o plano de SINALIZAÇÃO e delega a mídia a um endpoint WebRTC externo.
 * Aqui a mídia é terminada dentro do gateway — a engine `zapo` (plugin
 * `@zapo-js/voip`) negocia o transporte, decodifica o Opus do WhatsApp e
 * entrega/aceita PCM 16 kHz mono.
 *
 * Só ÁUDIO é transportado. `isVideo` marca a chamada como vídeo na
 * sinalização, mas nenhuma mídia de vídeo é codificada — limitação da engine.
 */

export enum VoiceCallState {
  INITIATING = 'initiating',
  RINGING = 'ringing',
  INCOMING_RINGING = 'incoming_ringing',
  CONNECTING = 'connecting',
  ACTIVE = 'active',
  ON_HOLD = 'on_hold',
  ENDED = 'ended',
}

export enum VoiceCallDirection {
  OUTGOING = 'outgoing',
  INCOMING = 'incoming',
}

export enum VoiceCallEndReason {
  USER_ENDED = 'user_ended',
  DECLINED = 'declined',
  TIMEOUT = 'timeout',
  BUSY = 'busy',
  CANCELLED = 'cancelled',
  FAILED = 'failed',
  DO_NOT_DISTURB = 'do_not_disturb',
  UNKNOWN = 'unknown',
}

/** Estado canônico de uma chamada — o mesmo formato no REST e no webhook. */
export interface VoiceCallInfo {
  callId: string;
  /** jid do outro lado. */
  peerJid: string;
  direction: VoiceCallDirection;
  state: VoiceCallState;
  /** `audio` sempre; `video` só quando a sinalização marcou vídeo. */
  mediaType: 'audio' | 'video';
  /** epoch (ms) da criação da chamada. */
  createdAt: number;
  /** epoch (ms) em que a chamada ficou `active`. */
  connectedAt?: number;
  /** duração em segundos (preenchida no fim). */
  durationSecs?: number;
  endReason?: VoiceCallEndReason;
  /** áudio local mutado. */
  muted?: boolean;
  /** telefone de quem ligou, quando a engine resolve. */
  callerPhone?: string;
  /** `true` quando o limite de chamadas simultâneas impede aceitar esta. */
  acceptBlocked?: boolean;
}

export interface StartVoiceCallInput {
  /** número ou jid do destino. */
  to: string;
  /** marca como vídeo na sinalização (mídia de vídeo NÃO é transportada). */
  isVideo?: boolean;
  /** URL de um áudio a tocar assim que a chamada for atendida. */
  audioUrl?: string;
}

export interface PlayVoiceAudioInput {
  /** URL do áudio a tocar (mp3/wav/ogg — decodificado por ffmpeg). */
  url?: string;
  /** alternativa à URL: o áudio em base64. */
  base64?: string;
}

/** Motivo enviado ao encerrar/rejeitar; default por rota quando omitido. */
export interface EndVoiceCallInput {
  reason?: VoiceCallEndReason;
}
