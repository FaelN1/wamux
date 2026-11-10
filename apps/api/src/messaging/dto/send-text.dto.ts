import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendTextDto {
  /** destino: número (5511999999999) ou jid completo. */
  @ApiProperty({
    description: 'Destino: número em dígitos (5511999999999) ou jid completo do WhatsApp.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ description: 'Texto da mensagem.', example: 'Olá! Tudo bem?' })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiPropertyOptional({
    description: 'id de uma mensagem para citar (reply).',
    example: '3EB0C767D26A1D8B',
  })
  @IsOptional()
  @IsString()
  quotedMessageId?: string;

  @ApiPropertyOptional({
    description: 'Gera preview de link quando há URL no texto.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  linkPreview?: boolean;

  /** id do cliente para idempotência (dedup de reenvio). */
  @ApiPropertyOptional({
    description: 'id do cliente para idempotência (reenvio com o mesmo valor não duplica).',
    example: 'pedido-123',
  })
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
