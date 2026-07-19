/**
 * Recursos opcionais que um adapter pode ou não expor (forma final consolidada
 * + flags granulares de interativos). O serviço checa a
 * flag e responde 501/422 de forma uniforme quando faltar — nunca 500.
 *
 * Consumida pela API (gate por capability) e pelo painel/integrador via
 * `GET /instances/:id/capabilities` — "honestidade programática": nunca
 * prometer o que a engine não entrega.
 */
export interface ProviderCapabilities {
  /** etiquetas (WhatsApp Business). */
  labels?: boolean;
  /** bloquear/desbloquear contato. */
  block?: boolean;
  /** setar/consultar presença. */
  presence?: boolean;
  /** buscar mensagens de um chat com paginação. */
  fetchMessages?: boolean;
  /** checar se número tem WhatsApp. */
  checkNumbers?: boolean;
  /** marcar como lido. */
  markRead?: boolean;
  /** download de mídia sob demanda / formatos ricos. */
  media?: boolean;
  /** canais (@newsletter). */
  newsletter?: boolean;
  /** envio de mídia em canal — separado de `newsletter` porque é instável/incompleto a montante em mais de uma engine (ver docs/newsletter-contract-handoff.md). */
  newsletterMedia?: boolean;
  /** tipos de mídia que a engine NÃO aceita em canal mesmo com `newsletterMedia: true` (limitação estrutural pontual, ex.: document no webjs). */
  newsletterUnsupportedMediaTypes?: Array<'image' | 'video' | 'audio' | 'document' | 'sticker'>;
  /** envio de enquete em canal. */
  newsletterPoll?: boolean;
  /** gerência de grupos (criar, participantes, admins, assunto, convite). */
  groups?: boolean;
  /** gerência de comunidades (grupo-pai + subgrupos vinculados). */
  communities?: boolean;
  /** perfil da própria conta conectada (nome/foto). */
  profile?: boolean;
  /** foto de perfil de um contato/chat arbitrário por jid (Inbox — refetch de avatar). */
  contactAvatar?: boolean;
  /** history sync (import de histórico). */
  history?: boolean;
  /** reagir a uma mensagem (emoji). */
  reactions?: boolean;
  /** editar uma mensagem já enviada. */
  editMessage?: boolean;
  /** apagar uma mensagem (para todos / revoke). */
  deleteMessage?: boolean;
  /** enviar mensagem de localização. */
  location?: boolean;
  /** enviar cartão(ões) de contato (vCard). */
  contact?: boolean;
  /** postar Status/Stories (broadcast). */
  status?: boolean;
  /** templates HSM (Cloud API oficial). */
  templates?: boolean;
  // ── interativos — granular por tipo ──
  poll?: boolean;
  pollResults?: boolean;
  buttons?: boolean;
  list?: boolean;
  pix?: boolean;
}
