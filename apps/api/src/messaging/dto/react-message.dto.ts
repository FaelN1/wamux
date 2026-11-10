import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ReactMessageDto {
  /** chat da mensagem-alvo (jid ou número). */
  @ApiProperty({
    description: 'Chat da mensagem-alvo (jid ou número).',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** id da mensagem-alvo. */
  @ApiProperty({ description: 'id da mensagem-alvo.', example: '3EB0C767D26A1D8B' })
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  /** emoji; string vazia REMOVE a reação. */
  @ApiProperty({ description: 'Emoji da reação; string vazia REMOVE a reação.', example: '👍' })
  @IsString()
  emoji!: string;

  /** a mensagem-alvo foi enviada por nós? (default false). */
  @ApiPropertyOptional({
    description: 'A mensagem-alvo foi enviada por nós? (default false).',
    example: false,
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
