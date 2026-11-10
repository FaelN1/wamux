import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FlowSessionEntity } from './flow-session.entity';
import { FlowSessionService } from './flow-session.service';

/**
 * `@Global()` como o `InboxModule`: o `InstanceManagerService` (resposta do
 * Flow chegando) e o `FlowsService` (envio/endpoint) injetam o
 * `FlowSessionService`, e este módulo não depende de nenhum dos dois.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([FlowSessionEntity])],
  providers: [FlowSessionService],
  exports: [FlowSessionService],
})
export class FlowSessionsModule {}
