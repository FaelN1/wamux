import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MessageLogEntity } from '../messaging/message-log.entity';
import { WEBHOOK_QUEUE } from '../webhook/webhook.constants';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageLogEntity]),
    BullModule.registerQueue({ name: WEBHOOK_QUEUE }),
  ],
  controllers: [StatsController],
  providers: [StatsService],
})
export class StatsModule {}
