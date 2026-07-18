import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProvidersModule } from '../providers/providers.module';
import { SessionModule } from '../session/session.module';
import { WebhookModule } from '../webhook/webhook.module';
import { EventsModule } from '../events/events.module';
import { MessageLogEntity } from '../messaging/message-log.entity';
import { JidFilterService } from '../common/jid-filter.service';
import { MessageLogService } from '../messaging/message-log.service';
import { InstanceEntity } from './instance.entity';
import { InstanceService } from './instance.service';
import { InstanceManagerService } from './instance-manager.service';
import { InstanceController } from './instance.controller';
import { InboundWebhookController } from './inbound-webhook.controller';
import { IdentityController } from '../identity/identity.controller';
import { MediaController } from '../media/media.controller';
import { PublicMediaController } from '../media/public-media.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([InstanceEntity, MessageLogEntity]),
    ProvidersModule,
    SessionModule,
    WebhookModule,
    forwardRef(() => EventsModule),
  ],
  controllers: [
    InstanceController,
    InboundWebhookController,
    IdentityController,
    MediaController,
    PublicMediaController,
  ],
  providers: [InstanceService, InstanceManagerService, JidFilterService, MessageLogService],
  // exportados para o MessagingModule (envio) e para os guards de API key.
  exports: [InstanceService, InstanceManagerService, JidFilterService, MessageLogService],
})
export class InstanceModule {}
