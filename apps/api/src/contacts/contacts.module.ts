import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { ContactsController } from './contacts.controller';
import { ContactsService } from './contacts.service';
import { NumberCheckService } from './number-check.service';

@Module({
  // RateLimiterService + REDIS_CLIENT vêm dos módulos @Global (Throttle/Redis).
  imports: [InstanceModule],
  controllers: [ContactsController],
  providers: [ContactsService, NumberCheckService],
})
export class ContactsModule {}
