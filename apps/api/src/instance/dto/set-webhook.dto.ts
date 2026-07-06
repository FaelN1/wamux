import { IsArray, IsOptional, IsString, IsUrl, ValidateIf } from 'class-validator';

export class SetWebhookDto {
  /** URL de destino. Vazia/omitida = desabilita o webhook da instância. */
  @IsOptional()
  @ValidateIf((o: SetWebhookDto) => !!o.url)
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  events?: string[];
}
