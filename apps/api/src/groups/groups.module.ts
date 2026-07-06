import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

@Module({
  imports: [InstanceModule],
  controllers: [GroupsController],
  providers: [GroupsService],
})
export class GroupsModule {}
