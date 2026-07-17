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
