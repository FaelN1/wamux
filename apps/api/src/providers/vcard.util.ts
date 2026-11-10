import { ContactCard } from '@wamux/shared';

/** Monta um vCard 3.0 a partir do cartão canônico (ou devolve o `vcard` cru). */
export function buildVCard(card: ContactCard): string {
  if (card.vcard) return card.vcard;
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${card.fullName}`];
  if (card.organization) lines.push(`ORG:${card.organization}`);
  if (card.phone) {
    const digits = card.phone.replace(/\D/g, '');
    lines.push(`TEL;type=CELL;waid=${digits}:+${digits}`);
  }
  lines.push('END:VCARD');
  return lines.join('\n');
}
