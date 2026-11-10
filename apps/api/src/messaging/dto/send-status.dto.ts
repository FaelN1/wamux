import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendStatusDto {
  @ApiProperty({
    description: 'Tipo do status/story.',
    enum: ['text', 'image', 'video', 'audio'],
    example: 'text',
  })
  @IsIn(['text', 'image', 'video', 'audio'])
  type!: 'text' | 'image' | 'video' | 'audio';

  /** texto (type=text). */
  @ApiPropertyOptional({ description: 'Texto do status (type=text).', example: 'Bom dia!' })
  @IsOptional()
  @IsString()
  text?: string;

  /** legenda (mídia). */
  @ApiPropertyOptional({ description: 'Legenda (status de mídia).' })
  @IsOptional()
  @IsString()
  caption?: string;

  /** fonte da mídia (uma de url/base64). */
  @ApiPropertyOptional({
    description: 'URL pública da mídia. Informe url OU base64.',
    example: 'https://exemplo.com/story.jpg',
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({ description: 'Conteúdo da mídia em base64. Informe url OU base64.' })
  @IsOptional()
  @IsString()
  base64?: string;

  @ApiPropertyOptional({ description: 'MIME type da mídia.', example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  mimetype?: string;

  /** cor de fundo do status de texto (hex "#RRGGBB" ou inteiro ARGB). */
  @ApiPropertyOptional({
    description: 'Cor de fundo do status de texto (hex "#RRGGBB" ou inteiro ARGB).',
    example: '#25D366',
  })
  @IsOptional()
  @IsString()
  backgroundColor?: string;

  /** fonte do status de texto (0–5). */
  @ApiPropertyOptional({
    description: 'Fonte do status de texto (0 a 5).',
    minimum: 0,
    maximum: 5,
    example: 0,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  font?: number;

  /** destinatários específicos (jids); vazio = audiência padrão. */
  @ApiPropertyOptional({
    description: 'Destinatários específicos (jids); vazio/omitido = audiência padrão de status.',
    type: [String],
    example: ['5511999999999@s.whatsapp.net'],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statusJidList?: string[];
}
