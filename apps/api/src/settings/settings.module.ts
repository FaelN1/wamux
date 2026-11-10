import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettingsEntity } from './settings.entity';
import { SettingsService } from './settings.service';
import { SystemInfoService } from './system-info.service';
import { SettingsController } from './settings.controller';

/** Global para que MessagingService, WebhookProcessor e ProviderFactory possam
 * injetar SettingsService sem import explícito. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([SettingsEntity])],
  controllers: [SettingsController],
  providers: [SettingsService, SystemInfoService],
  exports: [SettingsService],
})
export class SettingsModule {}
