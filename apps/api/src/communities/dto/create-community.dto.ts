import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommunityDto {
  @ApiProperty({ description: 'Nome da comunidade.', example: 'Comunidade Oficial' })
  @IsString()
  @IsNotEmpty()
  subject!: string;

  @ApiPropertyOptional({
    description: 'Descrição da comunidade.',
    example: 'Espaço oficial de avisos e novidades.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'data URI/base64 ou URL da imagem de perfil.',
    example: 'https://exemplo.com/logo.png',
  })
  @IsOptional()
  @IsString()
  picture?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'jids ou números a adicionar no subgrupo padrão criado junto com a comunidade.',
    example: ['5511999999999'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  participants?: string[];

  @ApiPropertyOptional({
    description: 'Sai do subgrupo padrão (Geral) logo após criar — mantém só o grupo de anúncios.',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  removeDefaultGroup?: boolean;

  @ApiPropertyOptional({
    deprecated: true,
    description:
      'Alias legado de removeDefaultGroup — na prática o bot apenas sai (nenhuma engine ' +
      'apaga o histórico do grupo para os demais membros).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  deleteDefaultGroupChat?: boolean;
}
