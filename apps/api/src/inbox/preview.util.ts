import { MessageType, NormalizedMessage } from '@wamux/shared';
import {
  SendButtonsInput,
  SendListInput,
  SendLocationInput,
  SendMediaInput,
  SendPollInput,
  SendTextInput,
} from '../providers/provider.types';
import { OutboundKind, OutboundPayload } from '../messaging/outbound.constants';

const MEDIA_LABEL: Partial<Record<MessageType, string>> = {
  [MessageType.IMAGE]: '📷 Foto',
  [MessageType.VIDEO]: '🎥 Vídeo',
  [MessageType.AUDIO]: '🎤 Áudio',
  [MessageType.DOCUMENT]: '📄 Documento',
  [MessageType.STICKER]: '💟 Figurinha',
  [MessageType.LOCATION]: '📍 Localização',
  [MessageType.CONTACT]: '👤 Contato',
  [MessageType.POLL]: '📊 Enquete',
  [MessageType.BUTTONS]: 'Mensagem interativa',
  [MessageType.LIST]: 'Mensagem interativa',
  [MessageType.INTERACTIVE]: 'Mensagem interativa',
};

/** Preview de última mensagem (lista "Conversations") a partir de mensagem inbound. */
export function previewFromInbound(m: NormalizedMessage): string | undefined {
  return m.text || m.media?.caption || MEDIA_LABEL[m.type];
}

const MEDIA_TYPE_TO_MESSAGE_TYPE: Record<SendMediaInput['type'], MessageType> = {
  image: MessageType.IMAGE,
  video: MessageType.VIDEO,
  audio: MessageType.AUDIO,
  document: MessageType.DOCUMENT,
  sticker: MessageType.STICKER,
};

const KIND_TO_MESSAGE_TYPE: Record<OutboundKind, MessageType> = {
  text: MessageType.TEXT,
  media: MessageType.DOCUMENT, // sobrescrito por mediaMessageType() quando kind === 'media'
  poll: MessageType.POLL,
  buttons: MessageType.BUTTONS,
  list: MessageType.LIST,
  pix: MessageType.INTERACTIVE,
  location: MessageType.LOCATION,
};

/** `MessageType` do envio de saída, a partir do `kind`/payload do outbound. */
export function outboundMessageType(kind: OutboundKind, payload: OutboundPayload): MessageType {
  if (kind === 'media') return MEDIA_TYPE_TO_MESSAGE_TYPE[(payload as SendMediaInput).type];
  return KIND_TO_MESSAGE_TYPE[kind];
}

/** Preview de última mensagem a partir de um envio de saída (composer/API). */
export function previewFromOutbound(
  kind: OutboundKind,
  payload: OutboundPayload,
): string | undefined {
  switch (kind) {
    case 'text':
      return (payload as SendTextInput).text;
    case 'media': {
      const media = payload as SendMediaInput;
      return media.caption || MEDIA_LABEL[MEDIA_TYPE_TO_MESSAGE_TYPE[media.type]];
    }
    case 'poll':
      return `📊 ${(payload as SendPollInput).question}`;
    case 'buttons':
      return (payload as SendButtonsInput).text;
    case 'list':
      return (payload as SendListInput).text;
    case 'pix':
      return '💰 PIX';
    case 'location': {
      const loc = payload as SendLocationInput;
      return loc.name ? `📍 ${loc.name}` : MEDIA_LABEL[MessageType.LOCATION];
    }
    default:
      return undefined;
  }
}

/**
 * Texto CRU da mensagem outbound (sem decoração/emoji) — pro campo `text`
 * do `message_logs`, espelhando a semântica do inbound (`NormalizedMessage.text`
 * = texto real ou caption; `undefined` sem caption, nunca um label bonito).
 * `previewFromOutbound` (com emoji) é só pro preview da LISTA de conversas.
 */
export function outboundRawText(kind: OutboundKind, payload: OutboundPayload): string | undefined {
  switch (kind) {
    case 'text':
      return (payload as SendTextInput).text;
    case 'media':
      return (payload as SendMediaInput).caption;
    case 'poll':
      return (payload as SendPollInput).question;
    case 'buttons':
      return (payload as SendButtonsInput).text;
    case 'list':
      return (payload as SendListInput).text;
    default:
      return undefined;
  }
}

/**
 * `mediaUrl` servível pro outbound — o cliente mandou uma URL direto, OU
 * `MessagingService.sendMedia` promoveu o `base64` pra uma URL do nosso
 * store via `MediaService.prepareOutbound` (ver comentário lá — sem isso,
 * mídia mandada via base64 nunca tinha URL própria pra re-exibir na thread
 * depois). Sempre populado quando `kind === 'media'`.
 */
export function outboundMediaUrl(kind: OutboundKind, payload: OutboundPayload): string | undefined {
  if (kind !== 'media') return undefined;
  return (payload as SendMediaInput).url;
}

export function outboundMediaMimetype(
  kind: OutboundKind,
  payload: OutboundPayload,
): string | undefined {
  if (kind !== 'media') return undefined;
  return (payload as SendMediaInput).mimetype;
}

export function outboundMediaFilename(
  kind: OutboundKind,
  payload: OutboundPayload,
): string | undefined {
  if (kind !== 'media') return undefined;
  return (payload as SendMediaInput).filename;
}

export function outboundMediaCaption(
  kind: OutboundKind,
  payload: OutboundPayload,
): string | undefined {
  if (kind !== 'media') return undefined;
  return (payload as SendMediaInput).caption;
}
