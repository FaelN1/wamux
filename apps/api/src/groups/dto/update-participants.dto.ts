import { ArrayMinSize, IsArray, IsIn, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateParticipantsDto {
  @ApiProperty({
    type: [String],
    description: 'jids (…@s.whatsapp.net) ou números dos participantes alvo.',
    example: ['5511999999999'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  participants!: string[];

  @ApiProperty({
    enum: ['add', 'remove', 'promote', 'demote'],
    description: 'Ação a aplicar aos participantes (adicionar, remover, promover ou rebaixar).',
    example: 'add',
  })
  @IsIn(['add', 'remove', 'promote', 'demote'])
  action!: 'add' | 'remove' | 'promote' | 'demote';
}
