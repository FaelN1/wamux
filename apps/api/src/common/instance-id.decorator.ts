import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';

/**
 * Id da instância AUTORIZADA (resolvido no guard a partir da chave/rota).
 * Use no lugar de `@Param('id')` em rotas escopadas — nunca vem de `?instance=`.
 */
export const InstanceId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { wamuxInstanceId?: string }>();
  return req.wamuxInstanceId ?? req.params.id;
});
