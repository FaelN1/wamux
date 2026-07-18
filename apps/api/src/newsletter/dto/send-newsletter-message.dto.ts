import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/**
 * Envie `text` para texto simples, campos de mídia (gated por
 * `capabilities.newsletterMedia`/`newsletterUnsupportedMediaTypes`), ou
 * `pollQuestion`+`pollOptions` para enquete (gated por `newsletterPoll`).
 */
export class SendNewsletterMessageDto {
  @IsOptional() @IsString() text?: string;

  @IsOptional()
  @IsIn(['image', 'video', 'audio', 'document', 'sticker'])
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';

  @IsOptional() @IsString() mediaUrl?: string;
  @IsOptional() @IsString() mediaBase64?: string;
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsString() filename?: string;
  @IsOptional() @IsString() mimetype?: string;

  @IsOptional() @IsString() pollQuestion?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  pollOptions?: string[];
  @IsOptional() @IsInt() @Min(1) pollSelectableCount?: number;
}
