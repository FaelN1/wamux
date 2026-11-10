import { Module } from '@nestjs/common';
import { InstanceModule } from '../instance/instance.module';
import { CloudGroupsController } from './cloud-groups.controller';
import { CloudGroupsService } from './cloud-groups.service';

@Module({
  imports: [InstanceModule],
  controllers: [CloudGroupsController],
  providers: [CloudGroupsService],
})
export class CloudGroupsModule {}
