import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Envie `text` para texto simples, campos de mídia (gated por
 * `capabilities.newsletterMedia`/`newsletterUnsupportedMediaTypes`), ou
 * `pollQuestion`+`pollOptions` para enquete (gated por `newsletterPoll`).
 */
export class SendNewsletterMessageDto {
  @ApiPropertyOptional({
    description: 'Texto a publicar (sempre suportado).',
    example: 'Olá, canal!',
  })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({
    description: 'Tipo de mídia (gated por capabilities.newsletterMedia).',
    enum: ['image', 'video', 'audio', 'document', 'sticker'],
    example: 'image',
  })
  @IsOptional()
  @IsIn(['image', 'video', 'audio', 'document', 'sticker'])
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';

  @ApiPropertyOptional({
    description: 'URL pública da mídia (alternativa a mediaBase64).',
    example: 'https://cdn.exemplo.com/foto.jpg',
  })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({ description: 'Mídia em base64 (alternativa a mediaUrl).' })
  @IsOptional()
  @IsString()
  mediaBase64?: string;

  @ApiPropertyOptional({
    description: 'Legenda da mídia (default: usa o text).',
    example: 'Confira!',
  })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({ description: 'Nome do arquivo (documento).', example: 'catalogo.pdf' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ description: 'MIME type da mídia.', example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({
    description: 'Pergunta da enquete (gated por capabilities.newsletterPoll).',
    example: 'Qual seu produto favorito?',
  })
  @IsOptional()
  @IsString()
  pollQuestion?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Opções da enquete (mín. 2).',
    example: ['Produto A', 'Produto B'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  pollOptions?: string[];

  @ApiPropertyOptional({
    description: 'Qtd. de opções selecionáveis (1 = escolha única).',
    example: 1,
    minimum: 1,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  pollSelectableCount?: number;
}
