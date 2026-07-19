import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ApiKeyAction } from '@wamux/shared';
import { Request } from 'express';
import { InstanceService } from '../../instance/instance.service';
import { ApiKeyService, hashApiKey } from '../../api-keys/api-key.service';
import { SCOPE_KEY } from '../require-scope.decorator';
import { extractApiKey } from './global-api-key.guard';

/** Todas as ações — key mestra da instância ou GLOBAL_API_KEY (retrocompat total). */
const ALL_ACTIONS = Object.values(ApiKeyAction);

/**
 * Autoriza rotas escopadas a uma instância (`:id`). Aceita:
 *  - a GLOBAL_API_KEY (admin, todas as ações em qualquer instância), ou
 *  - a apiKey MESTRA daquela instância (todas as ações, só nela), ou
 *  - uma key ESCOPADA (`ApiKeyEntity`) daquela instância — ações limitadas
 *    ao `actions` da key; se a rota tiver `@RequireScope(...)` e a key não
 *    cobrir, 403 (key válida, sem permissão — distinto de 401).
 *
 * Anti-bypass (CWE-639): o id efetivo vem SÓ da rota validada, nunca de
 * query/body. É gravado em `req.wamuxInstanceId` (lido pelo `@InstanceId()`).
 * Chave de instância na rota de OUTRA instância → 404 (não vaza existência).
 *
 * Rota SEM `@RequireScope()` não tem checagem de ação — comportamento
 * idêntico a antes desta mudança (ver `docs/api-keys-mcp-handoff.md` §4/§9).
 */
@Injectable()
export class InstanceApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly instances: InstanceService,
    private readonly apiKeys: ApiKeyService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { wamuxInstanceId?: string; wamuxKeyActions?: ApiKeyAction[] }>();
    const key = extractApiKey(req);
    if (!key) throw new UnauthorizedException('API key ausente');

    const routeId = req.params.id ?? req.params.instanceId; // SÓ da rota

    // Chave global (admin): id efetivo = o da rota, todas as ações.
    if (key === this.config.get<string>('globalApiKey')) {
      req.wamuxInstanceId = routeId;
      req.wamuxKeyActions = ALL_ACTIONS;
      return this.checkScope(context, ALL_ACTIONS);
    }

    // Chave mestra de instância: id efetivo = DONO DA CHAVE, todas as ações.
    const instance = await this.instances.findByApiKey(key);
    if (instance) {
      if (routeId && routeId !== instance.id) {
        throw new NotFoundException(`Instância ${routeId} não encontrada`);
      }
      req.wamuxInstanceId = instance.id;
      req.wamuxKeyActions = ALL_ACTIONS;
      (req as Request & { instance?: unknown }).instance = instance;
      return this.checkScope(context, ALL_ACTIONS);
    }

    // Key escopada: busca por hash, ações limitadas ao que foi concedido.
    const scopedKey = await this.apiKeys.findActiveByHash(hashApiKey(key));
    if (!scopedKey) throw new UnauthorizedException('API key inválida');
    if (routeId && routeId !== scopedKey.instanceId) {
      throw new NotFoundException(`Instância ${routeId} não encontrada`);
    }
    req.wamuxInstanceId = scopedKey.instanceId;
    req.wamuxKeyActions = scopedKey.actions;
    void this.apiKeys.touchLastUsed(scopedKey.id);
    return this.checkScope(context, scopedKey.actions);
  }

  private checkScope(context: ExecutionContext, granted: ApiKeyAction[]): boolean {
    const required = this.reflector.get<ApiKeyAction[]>(SCOPE_KEY, context.getHandler()) ?? [];
    if (required.length === 0) return true; // sem @RequireScope() — sem checagem extra
    const missing = required.filter((a) => !granted.includes(a));
    if (missing.length > 0) {
      throw new ForbiddenException(`Key sem permissão: falta "${missing.join(', ')}"`);
    }
    return true;
  }
}
