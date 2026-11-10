import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';

@Module({
  imports: [InstanceModule],
  controllers: [CallsController],
  providers: [CallsService],
})
export class CallsModule {}
