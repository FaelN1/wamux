import { ChatType } from '@wamux/shared';

/**
 * Classificação de tipo por sufixo do jid — mesma lógica de
 * `providers/jid.util.ts#classifyJid`, duplicada aqui (não engine-specific,
 * só convenção de protocolo) pra não criar dependência de `inbox/` em
 * `providers/`. `NormalizedMessage.chatType` já vem preenchido só pra
 * baileys/webjs hoje — o store não pode depender dele existir.
 */
export function chatTypeFromJid(jid: string): ChatType {
  if (jid.endsWith('@newsletter')) return 'newsletter';
  if (jid.endsWith('@g.us')) return 'group';
  if (jid.endsWith('@broadcast')) return 'broadcast';
  return 'user';
}
