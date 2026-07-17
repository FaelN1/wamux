import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateCommunityDto {
  @IsString() @IsNotEmpty() subject!: string;

  @IsOptional() @IsString() description?: string;

  /** data URI/base64 ou URL da imagem de perfil. */
  @IsOptional() @IsString() picture?: string;

  /** jids ou números a adicionar no subgrupo padrão criado junto com a comunidade. */
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  participants?: string[];

  @IsOptional() @IsBoolean() removeDefaultGroup?: boolean;

  /** @deprecated alias de removeDefaultGroup — mantido por paridade com integrações legadas. */
  @IsOptional() @IsBoolean() deleteDefaultGroupChat?: boolean;
}
