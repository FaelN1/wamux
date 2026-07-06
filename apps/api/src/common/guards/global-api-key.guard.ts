import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

/** Extrai a API key do header `apikey` ou `Authorization: Bearer <key>`. */
export function extractApiKey(req: Request): string | undefined {
  const header = req.headers['apikey'];
  if (typeof header === 'string' && header) return header;
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    return auth.slice('Bearer '.length);
  }
  return undefined;
}

/**
 * Exige a GLOBAL_API_KEY (admin). Protege rotas de gestão: criar/listar/
 * remover instâncias.
 */
@Injectable()
export class GlobalApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = extractApiKey(req);
    if (!key || key !== this.config.get<string>('globalApiKey')) {
      throw new UnauthorizedException('API key global inválida');
    }
    return true;
  }
}
