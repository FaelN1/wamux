import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EditMessageDto {
  /** chat da mensagem-alvo (jid ou número). */
  @ApiProperty({ description: 'Chat da mensagem-alvo (jid ou número).', example: '5511999999999' })
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** id da mensagem-alvo. */
  @ApiProperty({ description: 'id da mensagem-alvo.', example: '3EB0C767D26A1D8B' })
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  /** novo texto. */
  @ApiProperty({ description: 'Novo texto da mensagem.', example: 'Texto corrigido' })
  @IsString()
  @IsNotEmpty()
  text!: string;

  /** a mensagem-alvo foi enviada por nós? (default true — só a própria é editável). */
  @ApiPropertyOptional({
    description: 'A mensagem-alvo foi enviada por nós? (default true — só a própria é editável).',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  fromMe?: boolean;

  /** em grupo: jid do autor da mensagem-alvo. */
  @ApiPropertyOptional({ description: 'Em grupo: jid do autor da mensagem-alvo.' })
  @IsOptional()
  @IsString()
  participant?: string;
}
