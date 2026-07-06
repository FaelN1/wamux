import {
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
} from 'class-validator';
import { ProviderType } from '../../providers/provider.types';

export class CreateInstanceDto {
  /** nome único e legível da instância (ex.: "vendas-01"). */
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'name deve conter apenas letras, números, _ ou -',
  })
  name!: string;

  @IsEnum(ProviderType, {
    message: `provider deve ser um de: ${Object.values(ProviderType).join(', ')}`,
  })
  provider!: ProviderType;

  /**
   * Config específica do provider. Ex. para cloud:
   * { "phoneNumberId": "...", "accessToken": "...", "wabaId": "..." }
   */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  webhookEvents?: string[];
}
