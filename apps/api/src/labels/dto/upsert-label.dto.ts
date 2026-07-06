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

class LabelColorDto {
  @IsOptional() @IsInt() @Min(0) @Max(19) index?: number;
  @IsOptional() @IsHexColor() hex?: string;
}

export class UpsertLabelDto {
  /** omitido = criar; presente = editar a etiqueta existente. */
  @IsOptional() @IsString() id?: string;

  @IsString() @IsNotEmpty() name!: string;

  @IsOptional() @ValidateNested() @Type(() => LabelColorDto) color?: LabelColorDto;
}
