import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendPollDto {
  @ApiProperty({
    description: 'Destino: número em dígitos (5511999999999) ou jid completo do WhatsApp.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ description: 'Pergunta da enquete.', example: 'Qual seu horário preferido?' })
  @IsString()
  @IsNotEmpty()
  question!: string;

  @ApiProperty({
    description: 'Opções da enquete (mínimo 2, máximo 12).',
    type: [String],
    example: ['Manhã', 'Tarde', 'Noite'],
  })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(12)
  @IsString({ each: true })
  options!: string[];

  /** quantas opções podem ser marcadas (default 1). */
  @ApiPropertyOptional({
    description: 'Quantas opções podem ser marcadas (1 a 12). Default 1 (escolha única).',
    minimum: 1,
    maximum: 12,
    example: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  selectableCount?: number;

  @ApiPropertyOptional({
    description: 'id do cliente para idempotência (reenvio com o mesmo valor não duplica).',
  })
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
