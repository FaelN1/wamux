import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstanceModule } from '../instance/instance.module';
import { WebhookModule } from '../webhook/webhook.module';
import { MessageLogEntity } from '../messaging/message-log.entity';
import { HistoryImportJobEntity } from './history-job.entity';
import { HistoryController } from './history.controller';
import { HistoryService } from './history.service';
import { HistoryImportProcessor } from './history-import.processor';
import { HISTORY_QUEUE } from './history.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([HistoryImportJobEntity, MessageLogEntity]),
    BullModule.registerQueue({ name: HISTORY_QUEUE }),
    InstanceModule,
    WebhookModule,
  ],
  controllers: [HistoryController],
  providers: [HistoryService, HistoryImportProcessor],
})
export class HistoryModule {}
