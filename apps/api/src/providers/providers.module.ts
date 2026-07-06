import { Module } from '@nestjs/common';
import { ProviderFactory } from './provider.factory';
import { InstanceRegistryService } from './instance-registry.service';

/**
 * Peças transversais de provider: a factory (cria adapters) e o registry
 * distribuído (quem-tem-o-quê). Ambos exportados para o InstanceManager.
 */
@Module({
  providers: [ProviderFactory, InstanceRegistryService],
  exports: [ProviderFactory, InstanceRegistryService],
})
export class ProvidersModule {}
