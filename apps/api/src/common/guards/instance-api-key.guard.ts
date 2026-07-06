import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { InstanceService } from '../../instance/instance.service';
import { extractApiKey } from './global-api-key.guard';

/**
 * Autoriza rotas escopadas a uma instância (`:id`). Aceita:
 *  - a GLOBAL_API_KEY (admin), ou
 *  - a apiKey própria daquela instância.
 *
 * Anti-bypass (CWE-639): o id efetivo vem SÓ da rota validada, nunca de
 * query/body. É gravado em `req.wamuxInstanceId` (lido pelo `@InstanceId()`).
 * Chave de instância na rota de OUTRA instância → 404 (não vaza existência).
 */
@Injectable()
export class InstanceApiKeyGuard implements CanActivate {
  constructor(
    private readonly config: ConfigService,
    private readonly instances: InstanceService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { wamuxInstanceId?: string }>();
    const key = extractApiKey(req);
    if (!key) throw new UnauthorizedException('API key ausente');

    const routeId = req.params.id ?? req.params.instanceId; // SÓ da rota

    // Chave global (admin): id efetivo = o da rota.
    if (key === this.config.get<string>('globalApiKey')) {
      req.wamuxInstanceId = routeId;
      return true;
    }

    // Chave de instância: id efetivo = DONO DA CHAVE (imutável pelo cliente).
    const instance = await this.instances.findByApiKey(key);
    if (!instance) throw new UnauthorizedException('API key inválida');
    if (routeId && routeId !== instance.id) {
      throw new NotFoundException(`Instância ${routeId} não encontrada`);
    }
    req.wamuxInstanceId = instance.id;
    (req as Request & { instance?: unknown }).instance = instance;
    return true;
  }
}
