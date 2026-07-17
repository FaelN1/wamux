import { IsOptional, IsString } from 'class-validator';

/** Envie exatamente um dos dois: `url` (link público) ou `base64` (dados brutos). */
export class UpdateCommunityImageDto {
  @IsOptional() @IsString() url?: string;
  @IsOptional() @IsString() base64?: string;
}
