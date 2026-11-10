// ── whitelist/blacklist de JIDs por instância ───────

export type FilterDirection = 'inbound' | 'outbound' | 'both';

export interface JidFilterConfig {
  /** Se não-vazia, SÓ estes JIDs passam (whitelist). */
  allowJids: string[];
  /** JIDs bloqueados (aplicado depois da whitelist). */
  blockJids: string[];
  /** Onde o filtro atua. */
  direction: FilterDirection;
}

export const EMPTY_JID_FILTER: JidFilterConfig = {
  allowJids: [],
  blockJids: [],
  direction: 'both',
};
