import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Perfil da PRÓPRIA conta conectada. Não confundir com o perfil de NEGÓCIO da
 * Cloud API (`account/`), que é outro recurso e outro DTO.
 */
export class UpdateOwnProfileDto {
  @ApiPropertyOptional({ description: 'Nome de exibição (pushName).', maxLength: 25 })
  @IsOptional()
  @IsString()
  @MaxLength(25)
  name?: string;

  @ApiPropertyOptional({ description: 'Recado ("about").', maxLength: 139 })
  @IsOptional()
  @IsString()
  @MaxLength(139)
  status?: string;

  @ApiPropertyOptional({ description: 'URL de onde a engine baixa o JPEG da foto.' })
  @IsOptional()
  @IsUrl()
  photoUrl?: string;
}
