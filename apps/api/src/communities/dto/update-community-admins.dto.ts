import { ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';

export class UpdateCommunityAdminsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  members!: string[];

  @IsIn(['promote', 'demote'])
  action!: 'promote' | 'demote';
}
