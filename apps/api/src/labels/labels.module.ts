import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { LabelsController } from './labels.controller';
import { LabelsService } from './labels.service';

@Module({
  imports: [InstanceModule],
  controllers: [LabelsController],
  providers: [LabelsService],
})
export class LabelsModule {}
