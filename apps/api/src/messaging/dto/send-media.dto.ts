import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendMediaDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsIn(['image', 'video', 'audio', 'document', 'sticker'])
  type!: 'image' | 'video' | 'audio' | 'document' | 'sticker';

  /** forneça uma das fontes: url (pública) OU base64. */
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  base64?: string;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsString()
  filename?: string;

  @IsOptional()
  @IsString()
  mimetype?: string;

  @IsOptional()
  @IsString()
  quotedMessageId?: string;

  // ── flags de mídia rica ──
  /** vídeo tocado como GIF (gifPlayback). */
  @IsOptional() @IsBoolean() asGif?: boolean;
  /** áudio enviado como mensagem de voz (PTT). */
  @IsOptional() @IsBoolean() asPtt?: boolean;
  /** vídeo enviado como vídeo-nota (PTV). */
  @IsOptional() @IsBoolean() asPtv?: boolean;
  /** sticker animado (WebP animado). */
  @IsOptional() @IsBoolean() animated?: boolean;

  /** id do cliente para idempotência (dedup de reenvio). */
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
