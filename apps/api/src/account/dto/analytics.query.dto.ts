import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Analytics de mensagens. Listas (phoneNumbers/…) separadas por vírgula. */
export class MessagingAnalyticsQueryDto {
  @ApiProperty({ description: 'Início da janela (epoch em segundos, UNIX).', example: 1717200000 })
  @Type(() => Number)
  @IsNumber()
  start!: number;

  @ApiProperty({ description: 'Fim da janela (epoch em segundos, UNIX).', example: 1719792000 })
  @Type(() => Number)
  @IsNumber()
  end!: number;

  @ApiPropertyOptional({
    enum: ['HALF_HOUR', 'DAY', 'MONTH'],
    description: 'Granularidade da agregação.',
    example: 'DAY',
  })
  @IsOptional()
  @IsIn(['HALF_HOUR', 'DAY', 'MONTH'])
  granularity?: 'HALF_HOUR' | 'DAY' | 'MONTH';

  @ApiPropertyOptional({
    description: 'IDs de números de telefone, separados por vírgula.',
    example: '5511999999999,5511888888888',
  })
  @IsOptional()
  @IsString()
  phoneNumbers?: string;

  @ApiPropertyOptional({
    description: 'Tipos de produto (números), separados por vírgula.',
    example: '0,2',
  })
  @IsOptional()
  @IsString()
  productTypes?: string;

  @ApiPropertyOptional({
    description: 'Códigos de país (ISO), separados por vírgula.',
    example: 'BR,US',
  })
  @IsOptional()
  @IsString()
  countryCodes?: string;
}

/** Analytics de preço por mensagem (custo/volume) — `pricing_analytics`. */
export class PricingAnalyticsQueryDto {
  @ApiProperty({ description: 'Início da janela (epoch em segundos, UNIX).', example: 1717200000 })
  @Type(() => Number)
  @IsNumber()
  start!: number;

  @ApiProperty({ description: 'Fim da janela (epoch em segundos, UNIX).', example: 1719792000 })
  @Type(() => Number)
  @IsNumber()
  end!: number;

  @ApiPropertyOptional({
    enum: ['HALF_HOUR', 'DAILY', 'MONTHLY'],
    description: 'Granularidade da agregação.',
    example: 'DAILY',
  })
  @IsOptional()
  @IsIn(['HALF_HOUR', 'DAILY', 'MONTHLY'])
  granularity?: 'HALF_HOUR' | 'DAILY' | 'MONTHLY';

  @ApiPropertyOptional({
    description: 'Métricas desejadas (COST, VOLUME), separadas por vírgula.',
    example: 'COST,VOLUME',
  })
  @IsOptional()
  @IsString()
  metricTypes?: string;

  @ApiPropertyOptional({
    description: 'Categorias de preço (ex.: MARKETING, UTILITY, AUTHENTICATION, SERVICE).',
    example: 'MARKETING,UTILITY',
  })
  @IsOptional()
  @IsString()
  pricingCategories?: string;

  @ApiPropertyOptional({
    description: 'Tipos de preço (ex.: REGULAR, FREE_CUSTOMER_SERVICE, FREE_ENTRY_POINT).',
    example: 'REGULAR',
  })
  @IsOptional()
  @IsString()
  pricingTypes?: string;

  @ApiPropertyOptional({ description: 'Números da WABA, separados por vírgula.' })
  @IsOptional()
  @IsString()
  phoneNumbers?: string;

  @ApiPropertyOptional({ description: 'Países (ISO-2), separados por vírgula.', example: 'BR' })
  @IsOptional()
  @IsString()
  countryCodes?: string;

  @ApiPropertyOptional({
    description: 'Dimensões (COUNTRY, PHONE, PRICING_CATEGORY, PRICING_TYPE, TIER).',
    example: 'PRICING_CATEGORY,COUNTRY',
  })
  @IsOptional()
  @IsString()
  dimensions?: string;
}
