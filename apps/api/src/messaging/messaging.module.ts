import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstanceModule } from '../instance/instance.module';
import { MessageLogEntity } from './message-log.entity';
import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';
import { OutboundProcessor } from './outbound.processor';
import { OUTBOUND_QUEUE } from './outbound.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([MessageLogEntity]),
    BullModule.registerQueue({ name: OUTBOUND_QUEUE }),
    InstanceModule,
  ],
  controllers: [MessagingController],
  providers: [MessagingService, OutboundProcessor],
  exports: [MessagingService],
})
export class MessagingModule {}
