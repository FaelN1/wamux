import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

/** Analytics de mensagens. Listas (phoneNumbers/…) separadas por vírgula. */
export class MessagingAnalyticsQueryDto {
  @Type(() => Number) @IsNumber() start!: number;
  @Type(() => Number) @IsNumber() end!: number;

  @IsOptional()
  @IsIn(['HALF_HOUR', 'DAY', 'MONTH'])
  granularity?: 'HALF_HOUR' | 'DAY' | 'MONTH';

  @IsOptional() @IsString() phoneNumbers?: string;
  @IsOptional() @IsString() productTypes?: string;
  @IsOptional() @IsString() countryCodes?: string;
}

/** Analytics de conversas (custo/volume). */
export class ConversationAnalyticsQueryDto {
  @Type(() => Number) @IsNumber() start!: number;
  @Type(() => Number) @IsNumber() end!: number;

  @IsOptional()
  @IsIn(['HALF_HOUR', 'DAILY', 'MONTHLY'])
  granularity?: 'HALF_HOUR' | 'DAILY' | 'MONTHLY';

  @IsOptional() @IsString() metricTypes?: string;
  @IsOptional() @IsString() conversationCategories?: string;
  @IsOptional() @IsString() dimensions?: string;
}
