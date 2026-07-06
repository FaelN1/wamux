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
  /** gerência de grupos (criar, participantes, admins, assunto, convite). */
  groups?: boolean;
  /** history sync (import de histórico). */
  history?: boolean;
  // ── interativos — granular por tipo ──
  poll?: boolean;
  pollResults?: boolean;
  buttons?: boolean;
  list?: boolean;
  pix?: boolean;
}
