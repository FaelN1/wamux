import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListContactsQueryDto {
  /** cursor opaco = `jid` do último item da página anterior. */
  @ApiPropertyOptional({
    description: 'Cursor opaco = jid do último item da página anterior.',
    example: '5511999999999@s.whatsapp.net',
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
    description: 'Busca por nome/pushName/número (contém, case-insensitive).',
    example: 'maria',
  })
  @IsOptional()
  @IsString()
  q?: string;
}
