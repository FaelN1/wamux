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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DEFAULT_PROVIDER } from '@wamux/shared';
import { ProviderType } from '../../providers/provider.types';

export class CreateInstanceDto {
  @ApiProperty({
    description: 'Nome único e legível da instância (apenas letras, números, _ ou -).',
    example: 'vendas-01',
    pattern: '^[a-zA-Z0-9_-]+$',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-zA-Z0-9_-]+$/, {
    message: 'name deve conter apenas letras, números, _ ou -',
  })
  name!: string;

  @ApiPropertyOptional({
    enum: ProviderType,
    default: DEFAULT_PROVIDER,
    description: `Engine que a instância usará. Fixada na criação. Omitido, assume "${DEFAULT_PROVIDER}".`,
    example: DEFAULT_PROVIDER,
  })
  @IsOptional()
  @IsEnum(ProviderType, {
    message: `provider deve ser um de: ${Object.values(ProviderType).join(', ')}`,
  })
  provider: ProviderType = DEFAULT_PROVIDER;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: true,
    description:
      'Config específica do provider. Ex. cloud: { phoneNumberId, accessToken, wabaId }; whatsmeow: { userToken }.',
    example: { phoneNumberId: '1234567890', accessToken: 'EAAG...', wabaId: '9876543210' },
  })
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Webhook inicial (atalho — pode ser definido depois em PUT /webhook).',
    example: 'https://meu-app.com/webhooks/wa',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  webhookUrl?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Eventos entregues no webhook inicial (vazio/omitido = todos).',
    example: ['messages.upsert', 'connection.update'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  webhookEvents?: string[];
}
