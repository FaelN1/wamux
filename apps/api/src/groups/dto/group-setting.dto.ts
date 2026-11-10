import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class GroupSettingDto {
  @ApiProperty({
    enum: ['announcement', 'not_announcement', 'locked', 'unlocked'],
    description:
      'announcement/not_announcement → só admins enviam mensagens (on/off); ' +
      'locked/unlocked → só admins editam as infos do grupo (on/off).',
    example: 'announcement',
  })
  @IsIn(['announcement', 'not_announcement', 'locked', 'unlocked'])
  setting!: 'announcement' | 'not_announcement' | 'locked' | 'unlocked';
}
