import { SetMetadata } from '@nestjs/common';
import { ApiKeyAction } from '@wamux/shared';

export const SCOPE_KEY = 'scope';

/**
 * Exige que a API key resolvida tenha TODAS as ações listadas — lido pelo
 * `InstanceApiKeyGuard`. Rota sem esse decorator não tem checagem extra
 * (comportamento idêntico a hoje — qualquer key válida da instância acessa).
 * Ver `docs/api-keys-mcp-handoff.md` §4/§5.
 */
export const RequireScope = (...actions: ApiKeyAction[]) => SetMetadata(SCOPE_KEY, actions);
