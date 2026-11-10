import { IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Envie exatamente um dos dois: `url` (link público) ou `base64` (dados brutos). */
export class UpdateCommunityImageDto {
  @ApiPropertyOptional({
    description: 'Link público da imagem (envie url OU base64).',
    example: 'https://exemplo.com/logo.png',
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({
    description: 'Imagem em dados brutos/data URI (envie url OU base64).',
  })
  @IsOptional()
  @IsString()
  base64?: string;
}
