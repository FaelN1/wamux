import { ChatType } from './provider.types';

/**
 * Classificador único de JID — fonte da verdade para "que tipo de
 * destino é este JID". Todo `toJid`/`normalize`/roteamento passa por aqui, o
 * que elimina o "alguns aceitam @newsletter, outros não".
 */
export function classifyJid(jidOrNumber: string): ChatType {
  const jid = jidOrNumber.trim();
  if (jid.endsWith('@newsletter')) return 'newsletter';
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.endsWith('@broadcast')) return 'broadcast'; // inclui status@broadcast
  // usuário: @s.whatsapp.net, @c.us (webjs) e @lid
  return 'user';
}

/** Um número cru (sem `@`) precisa ser "completado" em JID de usuário. */
export function isBareNumber(to: string): boolean {
  return !to.includes('@');
}
