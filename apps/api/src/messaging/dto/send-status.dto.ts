import { IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class SendStatusDto {
  @IsIn(['text', 'image', 'video', 'audio'])
  type!: 'text' | 'image' | 'video' | 'audio';

  /** texto (type=text). */
  @IsOptional()
  @IsString()
  text?: string;

  /** legenda (mídia). */
  @IsOptional()
  @IsString()
  caption?: string;

  /** fonte da mídia (uma de url/base64). */
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  base64?: string;

  @IsOptional()
  @IsString()
  mimetype?: string;

  /** cor de fundo do status de texto (hex "#RRGGBB" ou inteiro ARGB). */
  @IsOptional()
  @IsString()
  backgroundColor?: string;

  /** fonte do status de texto (0–5). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  font?: number;

  /** destinatários específicos (jids); vazio = audiência padrão. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  statusJidList?: string[];
}
