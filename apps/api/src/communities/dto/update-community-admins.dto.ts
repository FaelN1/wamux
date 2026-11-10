import { ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCommunityAdminsDto {
  @ApiProperty({
    type: [String],
    description: 'jids (…@s.whatsapp.net) ou números dos membros alvo.',
    example: ['5511999999999'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  members!: string[];

  @ApiProperty({
    enum: ['promote', 'demote'],
    description: 'Promove a admin ou rebaixa a membro comum.',
    example: 'promote',
  })
  @IsIn(['promote', 'demote'])
  action!: 'promote' | 'demote';
}
