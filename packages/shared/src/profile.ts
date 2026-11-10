/**
 * Perfil da própria conta conectada na instância (nome/foto do WhatsApp).
 * Gated por `capabilities.profile` — engines que não suportam respondem 501
 * uniforme.
 */
export interface ProfileInfo {
  /** jid da própria conta. */
  jid: string;
  /** nome de exibição (pushName) configurado no WhatsApp. */
  name?: string;
  /** recado/status ("about"), quando a engine expõe. */
  status?: string;
  /** URL da foto de perfil atual. */
  profilePicUrl?: string;
}

/**
 * Atualização do perfil da PRÓPRIA conta conectada. Distinto de
 * `UpdateProfileInput` (account.ts), que é o perfil de NEGÓCIO da Cloud API —
 * são coisas diferentes e por isso não compartilham o tipo.
 *
 * Gated por `capabilities.updateOwnProfile`. Só campos presentes são enviados.
 */
export interface UpdateOwnProfileInput {
  /** nome de exibição (pushName). */
  name?: string;
  /** recado/"about". */
  status?: string;
  /** URL de onde a engine baixa o JPEG da foto. */
  photoUrl?: string;
}
