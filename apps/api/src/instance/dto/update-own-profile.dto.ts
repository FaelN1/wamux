import { IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min } from 'class-validator';
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

  @ApiPropertyOptional({
    description: 'Emoji ao lado do recado. Requer capabilities.statusEmoji (só whatsmeow).',
    example: '🚀',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  statusEmoji?: string;

  @ApiPropertyOptional({
    description: 'Expiração do recado em segundos. Ausente ou 0 = não expira. Máx. 7 dias.',
    minimum: 0,
    maximum: 604800,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(604800)
  statusDurationSec?: number;

  @ApiPropertyOptional({ description: 'URL de onde a engine baixa o JPEG da foto.' })
  @IsOptional()
  @IsUrl()
  photoUrl?: string;
}
