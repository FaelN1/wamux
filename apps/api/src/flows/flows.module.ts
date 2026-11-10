import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { FlowsController } from './flows.controller';
import { FlowsService } from './flows.service';
import { FlowEndpointController } from './flow-endpoint.controller';

@Module({
  imports: [InstanceModule],
  controllers: [FlowsController, FlowEndpointController],
  providers: [FlowsService],
})
export class FlowsModule {}
