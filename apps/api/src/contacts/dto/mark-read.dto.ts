import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MarkReadDto {
  @ApiPropertyOptional({
    type: [String],
    description:
      'IDs das mensagens RECEBIDAS a marcar como lidas. Obrigatório na Cloud API (ela ' +
      'confirma leitura por mensagem, não por chat); opcional nas demais engines.',
    example: ['wamid.HBgM...'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  messageIds?: string[];

  @ApiPropertyOptional({
    description: 'Cloud API: exibe "digitando…" (até 25s ou até a resposta) junto da leitura.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  typing?: boolean;
}
