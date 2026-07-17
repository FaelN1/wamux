/**
 * Comunidades do WhatsApp — grupo-pai que agrupa subgrupos vinculados
 * (um deles é sempre o grupo de anúncios). Modelo canônico compartilhado
 * entre API e painel. Gerência de comunidade é gated por
 * `capabilities.communities` — engines que não suportam respondem 501 uniforme.
 */

/** Papel do participante na comunidade (mesma semântica de `GroupParticipantRole`). */
export type CommunityParticipantRole = 'member' | 'admin' | 'superadmin';

export interface CommunityParticipant {
  /** jid do participante (…@s.whatsapp.net). */
  id: string;
  role: CommunityParticipantRole;
}

export interface CommunityInfo {
  /** jid da comunidade (…@g.us — comunidades são um tipo especial de grupo). */
  jid: string;
  subject: string;
  description?: string;
  /** jid do criador/dono. */
  owner?: string;
  participants: CommunityParticipant[];
  size: number;
  /** timestamp de criação (unix segundos). */
  creation?: number;
  /** true = só admins enviam mensagens no grupo-pai. */
  announce?: boolean;
  /** true = só admins editam infos da comunidade. */
  restrict?: boolean;
  /**
   * jid do subgrupo de anúncios. Pode vir `undefined` logo após a criação —
   * a resolução é assíncrona (ver evento `communities.announcement.discovered`).
   */
  announcementGroupJid?: string;
  /** jid do subgrupo "padrão" (Geral) criado automaticamente pela engine, se conhecido. */
  defaultGroupJid?: string;
  /** URL da foto de perfil da comunidade, quando disponível. */
  pictureUrl?: string;
}

export interface CreateCommunityInput {
  subject: string;
  description?: string;
  /** data URI/base64 ou URL da imagem de perfil da comunidade. */
  picture?: string;
  /** jids ou números a adicionar no subgrupo padrão criado junto com a comunidade. */
  participants?: string[];
  /**
   * Sai do subgrupo padrão (Geral) logo após a criação — mantém só o grupo
   * de anúncios. Nem toda engine distingue "sair" de "apagar" (ver
   * `deleteDefaultGroupChat` e as limitações documentadas no adapter).
   */
  removeDefaultGroup?: boolean;
  /**
   * Alias de `removeDefaultGroup` para paridade com integrações legadas.
   * Nenhuma engine hoje suportada apaga o histórico do grupo para os demais
   * membros — na prática equivale a `removeDefaultGroup` (o bot sai).
   */
  deleteDefaultGroupChat?: boolean;
}

/** Ação sobre admins da comunidade (subconjunto de `GroupParticipantAction`). */
export type CommunityAdminAction = 'promote' | 'demote';

/** Subgrupo vinculado a uma comunidade. */
export interface CommunityLinkedGroup {
  jid: string;
  subject: string;
  /** true = este é o subgrupo de anúncios (write-restricted, só admins postam). */
  isAnnounce?: boolean;
  size?: number;
}

export interface UpdateCommunityImageInput {
  url?: string;
  base64?: string;
}

/** Resultado da sondagem de convite (não expõe o código — só checa acessibilidade). */
export interface CommunityInviteProbeResult {
  reachable: boolean;
}
