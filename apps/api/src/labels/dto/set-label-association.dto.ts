import { IsBoolean, IsIn, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SetLabelAssociationDto {
  @ApiProperty({
    description: 'Tipo do alvo da associação.',
    enum: ['chat', 'contact'],
    example: 'chat',
  })
  @IsIn(['chat', 'contact'])
  targetType!: 'chat' | 'contact';

  /** jid do chat/contato (5511...@s.whatsapp.net | ...@g.us). */
  @ApiProperty({
    description: 'jid do chat/contato alvo.',
    example: '5511999999999@s.whatsapp.net',
  })
  @IsString()
  @IsNotEmpty()
  targetId!: string;

  /** true = associar; false = desassociar. */
  @ApiProperty({ description: 'true = associar a etiqueta; false = desassociar.', example: true })
  @IsBoolean()
  on!: boolean;
}
