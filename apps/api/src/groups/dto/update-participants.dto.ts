import { ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';

export class UpdateParticipantsDto {
  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  participants!: string[];

  @IsIn(['add', 'remove', 'promote', 'demote'])
  action!: 'add' | 'remove' | 'promote' | 'demote';
}
