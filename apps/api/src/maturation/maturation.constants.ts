export const MATURATION_QUEUE = 'maturation';

/** Job da cadeia principal: executa UM turno de conversa do plano. */
export interface MaturationTurnJob {
  planId: string;
}

/**
 * Job do lado receptor, agendado alguns segundos após o envio: marca a
 * conversa como lida e, com sorte (reactionChance), reage com emoji.
 */
export interface MaturationAckJob {
  planId: string;
  receiverId: string;
  /** jid do REMETENTE visto pelo receptor (o chat a marcar como lido). */
  chatJid: string;
  messageId: string;
  fromName: string;
  toName: string;
}

export type MaturationJob = MaturationTurnJob | MaturationAckJob;
