import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class ListChatMessagesQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  /**
   * cursor = timestamp (unix s) da mensagem mais antiga já vista — devolve
   * mensagens com `timestamp` menor que isso. Diferente do `before` da rota
   * ao vivo (`GET chats/:jid/messages`), que é um id opaco da engine.
   */
  @IsOptional() @Type(() => Number) @IsInt() before?: number;
}
