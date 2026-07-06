import { FilterDirection, JidFilterConfig } from '@wamux/shared';

/** Extrai só os dígitos do JID/número para comparar de forma robusta. */
function digits(jid: string): string {
  return jid.split('@')[0].split(':')[0].replace(/\D/g, '');
}

function listMatches(list: string[], jid: string): boolean {
  const d = digits(jid);
  return list.some((entry) => digits(entry) === d);
}

/**
 * Decide se o JID passa neste sentido. Precedência: whitelist (se
 * definida, só ela passa) → blacklist → segue. `true` = liberado.
 */
export function jidAllowed(
  filter: JidFilterConfig | undefined,
  jid: string,
  direction: Exclude<FilterDirection, 'both'>,
): boolean {
  if (!filter) return true;
  if (filter.direction !== 'both' && filter.direction !== direction) return true; // não atua aqui
  if (filter.allowJids.length > 0 && !listMatches(filter.allowJids, jid)) return false;
  if (filter.blockJids.length > 0 && listMatches(filter.blockJids, jid)) return false;
  return true;
}
