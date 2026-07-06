import { IsIn } from 'class-validator';

export class GroupSettingDto {
  @IsIn(['announcement', 'not_announcement', 'locked', 'unlocked'])
  setting!: 'announcement' | 'not_announcement' | 'locked' | 'unlocked';
}
