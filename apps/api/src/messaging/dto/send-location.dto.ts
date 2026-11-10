import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendLocationDto {
  @ApiProperty({
    description: 'Destino: número em dígitos (5511999999999) ou jid completo do WhatsApp.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({
    description: 'Latitude (-90 a 90).',
    example: -23.55052,
    minimum: -90,
    maximum: 90,
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({
    description: 'Longitude (-180 a 180).',
    example: -46.633308,
    minimum: -180,
    maximum: 180,
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiPropertyOptional({ description: 'Nome do local.', example: 'Praça da Sé' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'Endereço do local.', example: 'Sé, São Paulo - SP' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ description: 'id de uma mensagem para citar (reply).' })
  @IsOptional()
  @IsString()
  quotedMessageId?: string;

  /** id do cliente para idempotência (dedup de reenvio). */
  @ApiPropertyOptional({
    description: 'id do cliente para idempotência (reenvio com o mesmo valor não duplica).',
  })
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
