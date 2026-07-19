import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { CallingController } from './calling.controller';
import { CallingService } from './calling.service';

@Module({
  imports: [InstanceModule],
  controllers: [CallingController],
  providers: [CallingService],
})
export class CallingModule {}
