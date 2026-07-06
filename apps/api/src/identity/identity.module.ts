import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdentityMapEntity } from './identity-map.entity';
import { IdentityService } from './identity.service';

/**
 * Resolução de identidade. @Global para a ProviderFactory injetar o
 * resolver no ProviderContext sem import circular. O IdentityController é
 * registrado no InstanceModule (onde o guard de apikey já vive).
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IdentityMapEntity])],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
