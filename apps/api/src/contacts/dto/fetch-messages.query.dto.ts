import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class FetchMessagesQueryDto {
  @ApiPropertyOptional({
    description: 'Qtd. de mensagens a retornar (1..100; padrão 50).',
    example: 50,
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
    description:
      'Cursor opaco (id da mensagem mais antiga já vista, da engine) para paginar para trás.',
  })
  @IsOptional()
  @IsString()
  before?: string;
}
