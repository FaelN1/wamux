/**
 * Grupos do WhatsApp — modelo canônico compartilhado entre API e painel.
 * Gerência de grupo (criar, participantes, admins, assunto, convite) é gated
 * por `capabilities.groups` — engines que não suportam respondem 501 uniforme.
 */

/** Papel do participante no grupo. */
export type GroupParticipantRole = 'member' | 'admin' | 'superadmin';

export interface GroupParticipant {
  /** jid do participante (…@s.whatsapp.net). */
  id: string;
  role: GroupParticipantRole;
}

export interface GroupInfo {
  /** jid do grupo (…@g.us). */
  jid: string;
  subject: string;
  description?: string;
  /** jid do criador/dono. */
  owner?: string;
  participants: GroupParticipant[];
  size: number;
  /** timestamp de criação (unix segundos). */
  creation?: number;
  /** true = só admins enviam mensagens. */
  announce?: boolean;
  /** true = só admins editam infos do grupo. */
  restrict?: boolean;
  /** grupo é uma comunidade (agrupador). */
  isCommunity?: boolean;
  /** código de convite atual, quando conhecido. */
  inviteCode?: string;
  /** URL da foto de perfil do grupo, quando disponível. */
  pictureUrl?: string;
}

export interface CreateGroupInput {
  subject: string;
  /** jids ou números dos participantes iniciais. */
  participants: string[];
  description?: string;
}

/** Ação sobre participantes. */
export type GroupParticipantAction = 'add' | 'remove' | 'promote' | 'demote';

/**
 * Configuração do grupo:
 * - announcement / not_announcement → só admins podem enviar (on/off);
 * - locked / unlocked → só admins podem editar infos (on/off).
 */
export type GroupSetting = 'announcement' | 'not_announcement' | 'locked' | 'unlocked';

/** Resultado por participante de uma operação em massa. */
export interface GroupParticipantResult {
  jid: string;
  /** código de status da engine (ex.: "200", "409", "403"). */
  status: string;
}
