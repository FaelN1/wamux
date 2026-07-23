import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InstanceModule } from '../instance/instance.module';
import { MessagingModule } from '../messaging/messaging.module';
import { MaturationPlanEntity } from './maturation-plan.entity';
import { MaturationController } from './maturation.controller';
import { MaturationService } from './maturation.service';
import { MaturationMediaService } from './maturation-media.service';
import { MaturationProcessor } from './maturation.processor';
import { MATURATION_QUEUE } from './maturation.constants';

@Module({
  imports: [
    TypeOrmModule.forFeature([MaturationPlanEntity]),
    BullModule.registerQueue({ name: MATURATION_QUEUE }),
    InstanceModule,
    MessagingModule,
  ],
  controllers: [MaturationController],
  providers: [MaturationService, MaturationMediaService, MaturationProcessor],
})
export class MaturationModule {}
