import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';

/** Envie `text` para texto simples, ou os campos de mídia para foto/vídeo/áudio/documento. */
export class SendCommunityAnnouncementDto {
  @IsOptional() @IsString() text?: string;

  @IsOptional()
  @IsIn(['image', 'video', 'audio', 'document', 'sticker'])
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';

  @IsOptional() @IsString() mediaUrl?: string;
  @IsOptional() @IsString() mediaBase64?: string;
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsString() filename?: string;
  @IsOptional() @IsString() mimetype?: string;

  /** jids de comunidades adicionais para fanout do mesmo anúncio. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  communities?: string[];
}
