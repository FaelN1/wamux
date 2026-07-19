import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApiKeyEntity } from './api-key.entity';
import { ApiKeyService } from './api-key.service';
import { ApiKeysController } from './api-keys.controller';
import { InstanceModule } from '../instance/instance.module';

/**
 * API keys com escopo granular. `@Global()` — `InstanceApiKeyGuard`
 * (`common/guards/`) injeta `ApiKeyService` sem cada um dos ~13 módulos
 * que usam o guard precisar importar este módulo explicitamente (mesmo
 * padrão de `ActivityLogModule`/`MediaModule`/`InboxModule`). Importa
 * `InstanceModule` porque `ApiKeysController` usa `InstanceApiKeyGuard`
 * diretamente — o guard também precisa de `InstanceService` no contexto
 * do módulo que instancia o controller (edge nova, sem ciclo:
 * `InstanceModule` não importa `ApiKeysModule` de volta).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ApiKeyEntity]), InstanceModule],
  controllers: [ApiKeysController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeysModule {}
