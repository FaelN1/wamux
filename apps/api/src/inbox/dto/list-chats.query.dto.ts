import { Type } from 'class-transformer';
import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListChatsQueryDto {
  /** cursor opaco = `lastMessageAt` do último item da página anterior. */
  @ApiPropertyOptional({
    description: 'Cursor opaco = lastMessageAt (unix s) do último item da página anterior.',
    example: '1719772800',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Qtd. por página (1..100; padrão 30).',
    example: 30,
    minimum: 1,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Filtra por arquivados ("true"/"false"). Omitido = todos.',
    example: 'false',
  })
  @IsOptional()
  @IsBooleanString()
  archived?: string;

  @ApiPropertyOptional({
    description: 'Filtra por tipo de chat.',
    enum: ['user', 'group', 'newsletter', 'broadcast'],
    example: 'user',
  })
  @IsOptional()
  @IsIn(['user', 'group', 'newsletter', 'broadcast'])
  type?: string;

  /** busca por nome/pushName/número (contém, case-insensitive). */
  @ApiPropertyOptional({
    description: 'Busca por nome/pushName/número (contém, case-insensitive).',
    example: 'joão',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
