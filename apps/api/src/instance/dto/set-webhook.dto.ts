import { IsArray, IsBoolean, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetWebhookDto {
  @ApiPropertyOptional({
    description: 'URL de destino. Vazia/omitida desabilita o webhook da instância.',
    example: 'https://meu-app.com/webhooks/wa',
  })
  @IsOptional()
  @ValidateIf((o: SetWebhookDto) => !!o.url)
  @IsUrl({ require_tld: false })
  url?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Eventos entregues (vazio = todos).',
    example: ['messages.upsert'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];

  @ApiPropertyOptional({
    description:
      'Rotaciona (regenera) o segredo HMAC do webhook. O segredo é retornado apenas nesta resposta.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  rotateSecret?: boolean;
}
