import { Module } from '@nestjs/common';
import { ProviderFactory } from './provider.factory';
import { InstanceRegistryService } from './instance-registry.service';
import { ProviderCacheService } from './provider-cache.service';

/**
 * Peças transversais de provider: a factory (cria adapters) e o registry
 * distribuído (quem-tem-o-quê). Ambos exportados para o InstanceManager.
 * O `ProviderCacheService` (cache efêmero em Redis, injetado pela factory no
 * contexto dos adapters) é interno — o `REDIS_CLIENT` vem do RedisModule global.
 */
@Module({
  providers: [ProviderFactory, InstanceRegistryService, ProviderCacheService],
  exports: [ProviderFactory, InstanceRegistryService],
})
export class ProvidersModule {}
