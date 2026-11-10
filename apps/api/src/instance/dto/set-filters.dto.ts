import { IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetFiltersDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Whitelist de JIDs (vazio = tudo passa).',
    example: ['5511999999999@s.whatsapp.net'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowJids?: string[];

  @ApiPropertyOptional({
    type: [String],
    description: 'Blacklist de JIDs.',
    example: [],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockJids?: string[];

  @ApiPropertyOptional({
    enum: ['inbound', 'outbound', 'both'],
    default: 'both',
    description: 'Direção do fluxo em que o filtro se aplica.',
  })
  @IsOptional()
  @IsIn(['inbound', 'outbound', 'both'])
  direction?: 'inbound' | 'outbound' | 'both';
}
