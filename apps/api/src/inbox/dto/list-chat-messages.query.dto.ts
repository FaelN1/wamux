import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListChatMessagesQueryDto {
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
  /**
   * cursor = timestamp (unix s) da mensagem mais antiga já vista — devolve
   * mensagens com `timestamp` menor que isso. Diferente do `before` da rota
   * ao vivo (`GET chats/:jid/messages`), que é um id opaco da engine.
   */
  @ApiPropertyOptional({
    description:
      'Cursor = timestamp (unix s) da mensagem mais antiga já vista; devolve mensagens anteriores a ele.',
    example: 1719772800,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  before?: number;
}
