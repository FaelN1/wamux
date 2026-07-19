import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { MessagingModule } from '../messaging/messaging.module';
import { McpController } from './mcp.controller';

/**
 * Servidor MCP (`instances/:id/mcp`). Importa `InstanceModule` (o guard
 * usado pelo controller precisa de `InstanceService` no contexto — mesmo
 * motivo do `ApiKeysModule`) e `MessagingModule` (`MessagingService`,
 * exportado especificamente pra isso). `InboxQueryService` não precisa de
 * import — `InboxModule` é `@Global()`.
 */
@Module({
  imports: [InstanceModule, MessagingModule],
  controllers: [McpController],
})
export class McpModule {}
