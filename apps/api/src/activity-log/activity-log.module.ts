import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ActivityLogEntity } from './activity-log.entity';
import { ActivityLogService } from './activity-log.service';
import { ActivityLogQueryService } from './activity-log-query.service';
import { ActivityLogRetentionService } from './activity-log-retention.service';
import { ActivityLogController } from './activity-log.controller';
import { InstanceEntity } from '../instance/instance.entity';
import { EventsModule } from '../events/events.module';

/**
 * Painel de Logs/Atividade. `@Global()` — `ActivityLogService` é injetado
 * de fora (`InstanceManagerService`, pros 2 pontos de inserção não-HTTP)
 * sem precisar importar este módulo explicitamente, evitando o ciclo
 * `InstanceModule → ActivityLogModule → InstanceModule` (repositório de
 * `InstanceEntity` é lido direto aqui, não via `InstanceService`/
 * `InstanceModule`).
 *
 * A captura de request HTTP é um MIDDLEWARE Express puro
 * (`createActivityLogMiddleware`), não um interceptor Nest — registrado em
 * `main.ts`, não aqui, porque `app.use()` precisa da instância do serviço
 * já resolvida do container. Ver comentário no próprio middleware.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ActivityLogEntity, InstanceEntity]), EventsModule],
  controllers: [ActivityLogController],
  providers: [ActivityLogService, ActivityLogQueryService, ActivityLogRetentionService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
