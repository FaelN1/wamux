import { ArrayMinSize, IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateGroupDto {
  @ApiProperty({ description: 'Assunto (nome) do grupo.', example: 'Equipe de Vendas' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiProperty({
    type: [String],
    description: 'jids (…@s.whatsapp.net) ou números dos participantes iniciais.',
    example: ['5511999999999', '5511888888888'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  participants!: string[];

  @ApiPropertyOptional({
    description: 'Descrição inicial do grupo.',
    example: 'Grupo do time comercial',
  })
  @IsOptional()
  @IsString()
  description?: string;
}
