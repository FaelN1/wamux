import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstanceModule } from '../instance/instance.module';
import { ContactEntity } from './contact.entity';
import { MessageLogEntity } from '../messaging/message-log.entity';
import { InboxStoreService } from './inbox-store.service';
import { InboxQueryService } from './inbox-query.service';
import { InboxRetentionService } from './inbox-retention.service';
import { InboxController } from './inbox.controller';

/**
 * `@Global()` como `IdentityModule` — `InstanceManagerService` (instance/) e
 * `MessagingService` (messaging/) precisam injetar `InboxStoreService`, e
 * nenhum dos dois importa `InboxModule` de volta (pegam via visibilidade
 * global) — por isso `InboxModule` pode importar `InstanceModule` (só pro
 * `InstanceApiKeyGuard` do `InboxController` resolver `InstanceService`)
 * sem virar ciclo: a aresta é só nessa direção.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ContactEntity, MessageLogEntity]), InstanceModule],
  controllers: [InboxController],
  providers: [InboxStoreService, InboxQueryService, InboxRetentionService],
  exports: [InboxStoreService, InboxQueryService],
})
export class InboxModule {}
