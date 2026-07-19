import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { ApiKeyAction } from '@wamux/shared';
import { Request } from 'express';

/**
 * Ações da key AUTENTICADA (resolvidas no guard) — global/mestra = todas,
 * escopada = só as concedidas. Usado pra impor a regra anti-escalonamento
 * (uma key só pode criar outra com um subconjunto das próprias ações — ver
 * `docs/api-keys-mcp-handoff.md` §8). Fallback `[]` nunca deveria disparar
 * (o guard sempre popula isso pra qualquer request autenticado).
 */
export const KeyActions = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { wamuxKeyActions?: ApiKeyAction[] }>();
  return req.wamuxKeyActions ?? [];
});
