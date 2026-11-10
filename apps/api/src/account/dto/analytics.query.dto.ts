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

/** Analytics de conversas (custo/volume). */
export class ConversationAnalyticsQueryDto {
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
    description: 'Métricas desejadas (ex.: COST, CONVERSATION), separadas por vírgula.',
    example: 'COST,CONVERSATION',
  })
  @IsOptional()
  @IsString()
  metricTypes?: string;

  @ApiPropertyOptional({
    description: 'Categorias de conversa (ex.: MARKETING, UTILITY), separadas por vírgula.',
    example: 'MARKETING,UTILITY',
  })
  @IsOptional()
  @IsString()
  conversationCategories?: string;

  @ApiPropertyOptional({
    description: 'Dimensões de agrupamento (ex.: CONVERSATION_CATEGORY), separadas por vírgula.',
    example: 'CONVERSATION_CATEGORY,COUNTRY',
  })
  @IsOptional()
  @IsString()
  dimensions?: string;
}
