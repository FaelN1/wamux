import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCloudGroupDto {
  @ApiProperty({ description: 'Assunto (nome) do grupo.', example: 'Clientes VIP' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  /** participantes iniciais (números). Máx 8 no total (limite da Cloud). */
  @ApiPropertyOptional({
    type: [String],
    description: 'Participantes iniciais (números). Máx 8 no total (limite da Cloud).',
    example: ['5511999999999', '5511888888888'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  participants?: string[];
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
