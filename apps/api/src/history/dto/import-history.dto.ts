import { IsArray, IsBoolean, IsISO8601, IsOptional, IsString } from 'class-validator';

export class StartImportDto {
  /** início do range (ISO 8601). Omitido = sem limite inferior (best-effort). */
  @IsOptional() @IsISO8601() from?: string;
  /** fim do range (ISO 8601). Omitido = até agora. */
  @IsOptional() @IsISO8601() to?: string;
  /** chats (jids) a importar. Vazio = deixa a engine escolher (recent sync). */
  @IsOptional() @IsArray() @IsString({ each: true }) chats?: string[];
  /** reemitir cada mensagem no webhook com `historical: true` (Chatwoot). */
  @IsOptional() @IsBoolean() deliverToWebhook?: boolean;
}
