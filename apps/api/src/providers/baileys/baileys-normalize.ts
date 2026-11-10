import type { proto } from 'baileys';
import { parseNfmReply } from '../flow-response.util';
import { MessageType, NormalizedMessage } from '../provider.types';

/**
 * Tradução PURA do conteúdo (proto) de uma mensagem do Baileys para os campos
 * canônicos do `NormalizedMessage`. Recebe o conteúdo JÁ DESEMBRULHADO
 * (`normalizeMessageContent` do Baileys tira os envelopes ephemeral / viewOnce /
 * documentWithCaption / editedMessage) — por isso não depende do runtime ESM da
 * lib e é testável isoladamente.
 */
export type MappedContent = Pick<
  NormalizedMessage,
  | 'type'
  | 'text'
  | 'media'
  | 'location'
  | 'flowResponse'
  | 'contacts'
  | 'interactiveReply'
  | 'quotedMessageId'
  | 'quotedParticipant'
  | 'mentions'
  | 'forwarded'
  | 'referral'
>;

/** Chaves de `proto.IMessage` que nunca são "a" mensagem (metadados de transporte). */
const NON_CONTENT_KEYS = new Set(['messageContextInfo', 'senderKeyDistributionMessage']);

/** `ExternalAdReplyInfo.MediaType` (NONE=0, IMAGE=1, VIDEO=2) → string canônica. */
const AD_MEDIA_TYPES: Record<number, string> = { 1: 'image', 2: 'video' };

/** Telefones de um vCard: prefere o `waid` (número WhatsApp); senão o valor do TEL. */
export function vcardPhones(vcard: string | null | undefined): string[] {
  if (!vcard) return [];
  const phones: string[] = [];
  for (const line of vcard.split(/\r?\n/)) {
    const match = /^(?:[\w-]+\.)?TEL([^:]*):(.*)$/i.exec(line.trim());
    if (!match) continue;
    const waid = /waid=(\d+)/i.exec(match[1])?.[1];
    const phone = waid ?? match[2].trim();
    if (phone && !phones.includes(phone)) phones.push(phone);
  }
  return phones;
}

function toContact(c: {
  displayName?: string | null;
  vcard?: string | null;
}): NonNullable<NormalizedMessage['contacts']>[number] {
  const phones = vcardPhones(c.vcard);
  return {
    name: c.displayName ?? undefined,
    ...(phones.length ? { phones } : {}),
    ...(c.vcard ? { vcard: c.vcard } : {}),
  };
}

/** `contextInfo` da mensagem principal (cada tipo de mensagem carrega o seu). */
function findContextInfo(content: proto.IMessage): proto.IContextInfo | undefined {
  const bag = content as Record<string, unknown>;
  for (const key of Object.keys(bag)) {
    if (NON_CONTENT_KEYS.has(key)) continue;
    const value = bag[key];
    if (!value || typeof value !== 'object') continue;
    const ctx = (value as { contextInfo?: proto.IContextInfo | null }).contextInfo;
    if (ctx) return ctx;
  }
  return undefined;
}

/**
 * `externalAdReply` também é usado para preview de link "rico" comum; só vira
 * `referral` quando traz algum dado de ORIGEM (url/id/tipo/ctwaClid).
 */
function toReferral(
  ad: proto.ContextInfo.IExternalAdReplyInfo | null | undefined,
): NormalizedMessage['referral'] {
  if (!ad) return undefined;
  if (!ad.sourceUrl && !ad.sourceId && !ad.sourceType && !ad.ctwaClid) return undefined;
  const mediaType = ad.mediaType != null ? AD_MEDIA_TYPES[Number(ad.mediaType)] : undefined;
  return {
    ...(ad.sourceUrl ? { sourceUrl: ad.sourceUrl } : {}),
    ...(ad.sourceId ? { sourceId: ad.sourceId } : {}),
    ...(ad.sourceType ? { sourceType: ad.sourceType } : {}),
    ...(ad.title ? { headline: ad.title } : {}),
    ...(ad.body ? { body: ad.body } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(ad.ctwaClid ? { ctwaClid: ad.ctwaClid } : {}),
  };
}

export function mapBaileysContent(content: proto.IMessage): MappedContent {
  let type = MessageType.UNKNOWN;
  let text: string | undefined;
  let media: NormalizedMessage['media'];
  let flowResponse: NormalizedMessage['flowResponse'];
  let contacts: NormalizedMessage['contacts'];
  let interactiveReply: NormalizedMessage['interactiveReply'];

  const poll =
    content.pollCreationMessage ?? content.pollCreationMessageV2 ?? content.pollCreationMessageV3;

  if (content.conversation) {
    type = MessageType.TEXT;
    text = content.conversation;
  } else if (content.extendedTextMessage?.text) {
    type = MessageType.TEXT;
    text = content.extendedTextMessage.text;
  } else if (content.imageMessage) {
    type = MessageType.IMAGE;
    text = content.imageMessage.caption ?? undefined;
    media = { mimetype: content.imageMessage.mimetype ?? undefined, caption: text };
  } else if (content.videoMessage) {
    type = MessageType.VIDEO;
    text = content.videoMessage.caption ?? undefined;
    media = { mimetype: content.videoMessage.mimetype ?? undefined, caption: text };
  } else if (content.audioMessage) {
    type = MessageType.AUDIO;
    media = { mimetype: content.audioMessage.mimetype ?? undefined };
  } else if (content.documentMessage) {
    type = MessageType.DOCUMENT;
    // A legenda só existe quando o documento veio em `documentWithCaptionMessage`
    // (já desembrulhado); documento "puro" segue sem text/caption, como antes.
    const caption = content.documentMessage.caption || undefined;
    text = caption;
    media = {
      mimetype: content.documentMessage.mimetype ?? undefined,
      filename: content.documentMessage.fileName ?? undefined,
      ...(caption ? { caption } : {}),
    };
  } else if (content.stickerMessage) {
    type = MessageType.STICKER;
    media = { mimetype: content.stickerMessage.mimetype ?? undefined };
  } else if (content.locationMessage) {
    type = MessageType.LOCATION;
  } else if (content.contactMessage) {
    type = MessageType.CONTACT;
    contacts = [toContact(content.contactMessage)];
  } else if (content.contactsArrayMessage) {
    type = MessageType.CONTACT;
    contacts = (content.contactsArrayMessage.contacts ?? []).map(toContact);
  } else if (poll) {
    type = MessageType.POLL;
    text = poll.name ?? undefined;
  } else if (content.buttonsResponseMessage) {
    const r = content.buttonsResponseMessage;
    type = MessageType.INTERACTIVE;
    text = r.selectedDisplayText ?? undefined;
    interactiveReply = { type: 'button', id: r.selectedButtonId ?? undefined, title: text };
  } else if (content.templateButtonReplyMessage) {
    const r = content.templateButtonReplyMessage;
    type = MessageType.INTERACTIVE;
    text = r.selectedDisplayText ?? undefined;
    interactiveReply = { type: 'template_button', id: r.selectedId ?? undefined, title: text };
  } else if (content.listResponseMessage) {
    const r = content.listResponseMessage;
    type = MessageType.INTERACTIVE;
    text = r.title ?? undefined;
    interactiveReply = {
      type: 'list',
      id: r.singleSelectReply?.selectedRowId ?? undefined,
      title: text,
      description: r.description ?? undefined,
    };
  } else if (content.interactiveResponseMessage?.nativeFlowResponseMessage) {
    // resposta de Flow / nativeFlow: mesmo formato canônico da Cloud.
    const nfm = content.interactiveResponseMessage.nativeFlowResponseMessage;
    type = MessageType.INTERACTIVE;
    text = content.interactiveResponseMessage.body?.text ?? undefined;
    flowResponse = parseNfmReply({
      name: nfm.name ?? undefined,
      body: text,
      response_json: nfm.paramsJson ?? undefined,
    });
  }

  const ctx = findContextInfo(content);
  const mentions = (ctx?.mentionedJid ?? []).filter(Boolean);
  const referral = toReferral(ctx?.externalAdReply);

  return {
    type,
    text,
    media,
    ...(flowResponse ? { flowResponse } : {}),
    ...(contacts ? { contacts } : {}),
    ...(interactiveReply ? { interactiveReply } : {}),
    ...(ctx?.stanzaId ? { quotedMessageId: ctx.stanzaId } : {}),
    ...(ctx?.stanzaId && ctx.participant ? { quotedParticipant: ctx.participant } : {}),
    ...(mentions.length ? { mentions } : {}),
    ...(ctx?.isForwarded ? { forwarded: true } : {}),
    ...(referral ? { referral } : {}),
    location: content.locationMessage
      ? {
          latitude: content.locationMessage.degreesLatitude ?? 0,
          longitude: content.locationMessage.degreesLongitude ?? 0,
          name: content.locationMessage.name ?? undefined,
        }
      : undefined,
  };
}
