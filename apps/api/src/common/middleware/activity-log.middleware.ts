import { ConfigService } from '@nestjs/config';
import { ActivityLogStatus, ActivityLogType } from '@wamux/shared';
import { NextFunction, Request, Response } from 'express';
import { ActivityLogService } from '../../activity-log/activity-log.service';
import { extractApiKey } from '../guards/global-api-key.guard';

/** Padrões de rota (com `:id` já resolvido pelo Express) → categoria do painel. */
function resolveType(route: string): ActivityLogType {
  if (route.includes('/messages/')) return ActivityLogType.MESSAGING;
  if (route.includes('/groups')) return ActivityLogType.GROUPS;
  if (route.includes('/communities')) return ActivityLogType.COMMUNITIES;
  if (route.includes('/newsletters')) return ActivityLogType.NEWSLETTER;
  return ActivityLogType.API_REQUEST;
}

function statusFor(statusCode: number): ActivityLogStatus {
  if (statusCode === 501) return ActivityLogStatus.SKIPPED;
  if (statusCode >= 400) return ActivityLogStatus.FAILED;
  return ActivityLogStatus.SUCCESS;
}

function apiKeyLabelOf(req: Request, globalKey?: string): string {
  const key = extractApiKey(req);
  if (!key) return 'none';
  if (key === globalKey) return 'global';
  return `instance:${key.slice(0, 8)}`;
}

/**
 * Middleware Express (registrado via `app.use`, NÃO um interceptor Nest) —
 * de propósito: interceptors só rodam DEPOIS dos guards passarem, então uma
 * apikey inválida ou instância inexistente (rejeitada pelo guard) nunca
 * chegaria a um interceptor. Aqui, como o pino-http, penduramos em
 * `res.on('finish')` — roda pro ciclo INTEIRO do request, guard rejeitando
 * ou não. Ver `docs/logs-painel-handoff.md` §4/§11.1.
 */
export function createActivityLogMiddleware(
  activityLog: ActivityLogService,
  config: ConfigService,
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!activityLog.enabled) {
      next();
      return;
    }
    const start = Date.now();

    res.on('finish', () => {
      void (async () => {
        const includeGet = config.get<boolean>('activityLog.includeGetRequests') ?? false;
        if (req.method === 'GET' && !includeGet) return;

        const route = (req.route?.path as string | undefined) ?? req.path;
        const instanceId = (req.params as Record<string, string> | undefined)?.id;
        const globalKey = config.get<string>('globalApiKey');
        const platform = instanceId ? await activityLog.platformFor(instanceId) : undefined;

        await activityLog.record({
          instanceId,
          type: resolveType(route),
          status: statusFor(res.statusCode),
          activity: `${req.method} ${route}`,
          method: req.method,
          route,
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
          platform,
          apiKeyLabel: apiKeyLabelOf(req, globalKey),
        });
      })();
    });

    next();
  };
}
