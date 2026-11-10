import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Envie `text` para texto simples, ou os campos de mídia para foto/vídeo/áudio/documento. */
export class SendCommunityAnnouncementDto {
  @ApiPropertyOptional({
    description: 'Texto do anúncio (use este OU os campos de mídia).',
    example: 'Aviso importante para todos os membros!',
  })
  @IsOptional()
  @IsString()
  text?: string;

  @ApiPropertyOptional({
    enum: ['image', 'video', 'audio', 'document', 'sticker'],
    description: 'Tipo de mídia do anúncio (default: image quando há mídia).',
    example: 'image',
  })
  @IsOptional()
  @IsIn(['image', 'video', 'audio', 'document', 'sticker'])
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';

  @ApiPropertyOptional({
    description: 'URL pública da mídia (alternativa a mediaBase64).',
    example: 'https://exemplo.com/banner.png',
  })
  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @ApiPropertyOptional({
    description: 'Mídia em base64/data URI (alternativa a mediaUrl).',
  })
  @IsOptional()
  @IsString()
  mediaBase64?: string;

  @ApiPropertyOptional({
    description: 'Legenda da mídia (default: o próprio text).',
    example: 'Confira o comunicado em anexo.',
  })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({
    description: 'Nome do arquivo (usado em documentos).',
    example: 'comunicado.pdf',
  })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({
    description: 'MIME type da mídia, quando necessário.',
    example: 'application/pdf',
  })
  @IsOptional()
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'jids de comunidades adicionais para fanout do mesmo anúncio.',
    example: ['120363099999999999@g.us'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  communities?: string[];
}
