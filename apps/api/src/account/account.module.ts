import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [InstanceModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
