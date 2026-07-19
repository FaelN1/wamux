import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';

@Module({
  imports: [InstanceModule],
  controllers: [FlowsController],
  providers: [FlowsService],
})
export class FlowsModule {}
