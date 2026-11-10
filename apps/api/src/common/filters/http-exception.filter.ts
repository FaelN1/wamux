import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ProviderRequestError } from '../../providers/provider.interface';

/**
 * Filtro global: converte qualquer erro em uma resposta JSON consistente e
 * evita vazar stack traces. Erros não-HTTP viram 500.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    // Erro da fonte da engine (Meta/sidecar): repassa status + código + detalhes.
    if (exception instanceof ProviderRequestError) {
      if (exception.status >= 500) {
        this.logger.error(`${request.method} ${request.url} — ${exception.message}`);
      }
      response.status(exception.status).json({
        statusCode: exception.status,
        path: request.url,
        timestamp: new Date().toISOString(),
        error: {
          message: exception.message,
          code: exception.code,
          provider: exception.provider,
          ...(exception.details ? { details: exception.details } : {}),
        },
      });
      return;
    }

    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload = exception instanceof HttpException ? exception.getResponse() : 'Erro interno';

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      path: request.url,
      timestamp: new Date().toISOString(),
      error: typeof payload === 'string' ? { message: payload } : payload,
    });
  }
}
