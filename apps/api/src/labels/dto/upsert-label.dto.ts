import {
  IsHexColor,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class LabelColorDto {
  @ApiPropertyOptional({
    description: 'Índice da paleta de cores do WhatsApp (0..19).',
    example: 5,
    minimum: 0,
    maximum: 19,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(19)
  index?: number;

  @ApiPropertyOptional({ description: 'Cor em hex (#RRGGBB).', example: '#FF9500' })
  @IsOptional()
  @IsHexColor()
  hex?: string;
}

export class UpsertLabelDto {
  /** omitido = criar; presente = editar a etiqueta existente. */
  @ApiPropertyOptional({
    description: 'Omitido = criar nova etiqueta; presente = editar a etiqueta existente.',
    example: '12',
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ description: 'Nome da etiqueta.', example: 'Cliente VIP' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({
    type: LabelColorDto,
    description: 'Cor da etiqueta (índice de paleta e/ou hex).',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => LabelColorDto)
  color?: LabelColorDto;
}
