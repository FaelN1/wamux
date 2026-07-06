// ── etiquetas / labels ──────────────────────────────

/**
 * Cor de uma etiqueta. O WhatsApp trabalha com um índice de paleta (0..19);
 * o Baileys devolve esse índice, o whatsapp-web.js devolve um hex. Guardamos
 * ambos no modelo canônico e deixamos o painel decidir como pintar.
 */
export interface LabelColor {
  /** índice da paleta do WhatsApp (0..19), quando conhecido. */
  index?: number;
  /** hex derivado do índice (#RRGGBB), quando a lib informa. */
  hex?: string;
}

/** Etiqueta (label) do WhatsApp Business, normalizada. */
export interface Label {
  id: string;
  name: string;
  color?: LabelColor;
  /** contagem de itens etiquetados, quando a lib informa. */
  count?: number;
  /** false quando a etiqueta foi removida (Baileys marca `deleted` em labels.edit). */
  active?: boolean;
}

/** Alvo de uma associação: um chat OU um contato (1:1 → mesmo jid). */
export type LabelTargetType = 'chat' | 'contact';

export interface LabelTarget {
  type: LabelTargetType;
  /** jid do chat/contato: `5511...@s.whatsapp.net` ou `...@g.us`. */
  id: string;
}

/** Associação etiqueta ↔ alvo (espelha `labels.association` do Baileys). */
export interface LabelAssociation {
  labelId: string;
  target: LabelTarget;
  /** true = associada; false = desassociada. */
  on: boolean;
}

/** Entrada de criação/edição de etiqueta. */
export interface UpsertLabelInput {
  /** ausente = criar; presente = editar a etiqueta existente. */
  id?: string;
  name: string;
  color?: LabelColor;
}

// ── presença / contatos / check ─────────────────────

/** Estados de presença que a API aceita setar/reportar. */
export type PresenceState =
  | 'available'
  | 'unavailable'
  | 'composing' // "digitando…"
  | 'recording' // "gravando áudio…"
  | 'paused';

/** Presença observada de um contato/chat. */
export interface PresenceInfo {
  chatId: string;
  /** último estado conhecido (quando a engine informa). */
  lastKnownPresence?: PresenceState;
  /** epoch (s) do "visto por último", quando disponível. */
  lastSeen?: number;
}

/** Entrada de setPresence. */
export interface SetPresenceInput {
  to: string;
  state: PresenceState;
  /** por quanto tempo manter (ex.: composing por N ms antes de voltar a paused). */
  durationMs?: number;
}

/** Resultado de checagem de um número (existe no WhatsApp?). */
export interface NumberCheckResult {
  /** entrada crua enviada pelo cliente. */
  input: string;
  exists: boolean;
  /** jid resolvido quando existe. */
  jid?: string;
}

/**
 * Contato normalizado — `pushName` NUNCA volta vazio: a
 * normalização cai para verifiedName → notify → número quando faltar.
 */
export interface ContactInfo {
  jid: string;
  pushName: string;
  name?: string;
  notify?: string;
  verifiedName?: string;
  isBusiness?: boolean;
  isMe?: boolean;
}
