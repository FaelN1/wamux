import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

/**
 * Peças reutilizáveis de documentação OpenAPI (schemas de resposta e params
 * comuns), para os controllers não repetirem as mesmas formas. Textos em PT.
 */

/** Resposta padrão de ações sem corpo relevante: `{ ok: true }`. */
export const OK_SCHEMA: SchemaObject = {
  type: 'object',
  properties: { ok: { type: 'boolean', example: true } },
};

/** Param de rota `:id` (uuid) das rotas escopadas por instância. */
export const ID_PARAM = { name: 'id', description: 'ID (uuid) da instância.' } as const;

/** Param de rota `:jid` (JID do WhatsApp — contato/grupo/canal). */
export const JID_PARAM = {
  name: 'jid',
  description: 'JID do WhatsApp (ex.: 5511999999999@s.whatsapp.net, ...@g.us, ...@newsletter).',
} as const;
