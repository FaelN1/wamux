import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BusinessVertical } from '@wamux/shared';

const VERTICALS = [
  'OTHER',
  'AUTO',
  'BEAUTY',
  'APPAREL',
  'EDU',
  'ENTERTAIN',
  'EVENT_PLAN',
  'FINANCE',
  'GROCERY',
  'GOVT',
  'HOTEL',
  'HEALTH',
  'NONPROFIT',
  'PROF_SERVICES',
  'RETAIL',
  'TRAVEL',
  'RESTAURANT',
  'ALCOHOL',
  'ONLINE_GAMBLING',
  'PHYSICAL_GAMBLING',
  'OTC_DRUGS',
] as const;

export class UpdateProfileDto {
  @ApiPropertyOptional({
    description: 'Recado/"about" do perfil de negócio.',
    example: 'Aberto de seg a sex, 9h-18h.',
  })
  @IsOptional()
  @IsString()
  about?: string;

  @ApiPropertyOptional({
    description: 'Endereço do negócio.',
    example: 'Av. Paulista, 1000 - São Paulo/SP',
  })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({
    description: 'Descrição do negócio.',
    example: 'Loja de eletrônicos e acessórios.',
  })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({
    description: 'E-mail de contato do negócio.',
    example: 'contato@minhaloja.com',
  })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({
    enum: VERTICALS,
    description: 'Vertical/segmento de mercado do negócio.',
    example: 'RETAIL',
  })
  @IsOptional()
  @IsIn(VERTICALS)
  vertical?: BusinessVertical;

  @ApiPropertyOptional({
    type: [String],
    description: 'Sites do negócio (máx. 2).',
    maxItems: 2,
    example: ['https://minhaloja.com'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  websites?: string[];

  @ApiPropertyOptional({
    description: 'Handle da foto de perfil obtido na Resumable Upload API (não é o id do /media).',
    example: '4::aW1hZ2UvcG5n:...',
  })
  @IsOptional()
  @IsString()
  profilePictureHandle?: string;
}
