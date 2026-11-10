import { Controller, Get, Inject, VERSION_NEUTRAL } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { HealthCheck, HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

/** Resultado do health check (formato do @nestjs/terminus). */
const HEALTH_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    status: { type: 'string', enum: ['ok', 'error', 'shutting_down'], example: 'ok' },
    info: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
      description: 'indicadores "up" (ex.: postgres, redis)',
    },
    error: {
      type: 'object',
      nullable: true,
      additionalProperties: true,
      description: 'indicadores "down"',
    },
    details: {
      type: 'object',
      additionalProperties: true,
      description: 'estado de cada indicador (postgres, redis)',
    },
  },
};

/** VERSION_NEUTRAL: probes de orquestrador apontam para /api/health fixo. */
@ApiTags('Sistema')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness: Postgres + Redis. Pública (sem apikey); usada por probes.',
  })
  @ApiOkResponse({ description: 'Tudo saudável (status "ok").', schema: HEALTH_RESULT_SCHEMA })
  @ApiServiceUnavailableResponse({
    description: 'Algum indicador falhou (status "error").',
    schema: HEALTH_RESULT_SCHEMA,
  })
  check() {
    return this.health.check([
      () => this.db.pingCheck('postgres'),
      async () => {
        const pong = await this.redis.ping();
        return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
      },
    ]);
  }
}
