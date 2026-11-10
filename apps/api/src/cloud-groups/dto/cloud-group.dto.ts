import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCloudGroupDto {
  @ApiProperty({ description: 'Assunto (nome) do grupo.', example: 'Clientes VIP' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  /** A Groups API não aceita participantes na criação — eles entram pelo link de convite. */
  @ApiPropertyOptional({ description: 'Descrição do grupo.', example: 'Avisos e ofertas' })
  @IsOptional()
  @IsString()
  description?: string;
}

export class RemoveParticipantDto {
  @ApiProperty({
    description: 'wa_id (número) do participante a remover.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  waId!: string;
}
