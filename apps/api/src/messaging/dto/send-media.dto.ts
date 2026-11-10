import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SendMediaDto {
  @ApiProperty({
    description: 'Destino: número em dígitos (5511999999999) ou jid completo do WhatsApp.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({
    description: 'Tipo da mídia.',
    enum: ['image', 'video', 'audio', 'document', 'sticker'],
    example: 'image',
  })
  @IsIn(['image', 'video', 'audio', 'document', 'sticker'])
  type!: 'image' | 'video' | 'audio' | 'document' | 'sticker';

  /** forneça uma das fontes: url (pública) OU base64. */
  @ApiPropertyOptional({
    description: 'URL pública da mídia. Informe url OU base64.',
    example: 'https://exemplo.com/foto.jpg',
  })
  @IsOptional()
  @IsString()
  url?: string;

  @ApiPropertyOptional({
    description: 'Conteúdo da mídia em base64 (sem o prefixo data:). Informe url OU base64.',
  })
  @IsOptional()
  @IsString()
  base64?: string;

  @ApiPropertyOptional({ description: 'Legenda (imagem/vídeo/documento).', example: 'Confira!' })
  @IsOptional()
  @IsString()
  caption?: string;

  @ApiPropertyOptional({ description: 'Nome do arquivo (documento).', example: 'nota-fiscal.pdf' })
  @IsOptional()
  @IsString()
  filename?: string;

  @ApiPropertyOptional({ description: 'MIME type da mídia.', example: 'image/jpeg' })
  @IsOptional()
  @IsString()
  mimetype?: string;

  @ApiPropertyOptional({ description: 'id de uma mensagem para citar (reply).' })
  @IsOptional()
  @IsString()
  quotedMessageId?: string;

  // ── flags de mídia rica ──
  /** vídeo tocado como GIF (gifPlayback). */
  @ApiPropertyOptional({ description: 'Vídeo tocado como GIF (gifPlayback).', example: false })
  @IsOptional()
  @IsBoolean()
  asGif?: boolean;
  /** áudio enviado como mensagem de voz (PTT). */
  @ApiPropertyOptional({ description: 'Áudio enviado como mensagem de voz (PTT).', example: false })
  @IsOptional()
  @IsBoolean()
  asPtt?: boolean;
  /** vídeo enviado como vídeo-nota (PTV). */
  @ApiPropertyOptional({
    description: 'Vídeo enviado como vídeo-nota redonda (PTV).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  asPtv?: boolean;
  /** sticker animado (WebP animado). */
  @ApiPropertyOptional({ description: 'Sticker animado (WebP animado).', example: false })
  @IsOptional()
  @IsBoolean()
  animated?: boolean;

  /** id do cliente para idempotência (dedup de reenvio). */
  @ApiPropertyOptional({
    description: 'id do cliente para idempotência (reenvio com o mesmo valor não duplica).',
  })
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
