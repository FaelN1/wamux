import { IsArray, IsBoolean, IsISO8601, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class StartImportDto {
  /** início do range (ISO 8601). Omitido = sem limite inferior (best-effort). */
  @ApiPropertyOptional({
    description: 'Início do range (ISO 8601). Omitido = sem limite inferior (best-effort).',
    example: '2024-01-01T00:00:00Z',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  /** fim do range (ISO 8601). Omitido = até agora. */
  @ApiPropertyOptional({
    description: 'Fim do range (ISO 8601). Omitido = até agora.',
    example: '2024-12-31T23:59:59Z',
  })
  @IsOptional()
  @IsISO8601()
  to?: string;

  /** chats (jids) a importar. Vazio = deixa a engine escolher (recent sync). */
  @ApiPropertyOptional({
    type: [String],
    description: 'Chats (jids) a importar. Vazio = deixa a engine escolher (recent sync).',
    example: ['5511999999999@s.whatsapp.net'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  chats?: string[];

  /** reemitir cada mensagem no webhook com `historical: true` (Chatwoot). */
  @ApiPropertyOptional({
    description: 'Reemitir cada mensagem no webhook com historical:true (integração Chatwoot).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  deliverToWebhook?: boolean;
}
