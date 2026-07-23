import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/**
 * A validação FINA do `config` (ranges, coerências min/max) fica no
 * `zMaturationConfig` do shared, aplicada no service — fonte única com o
 * painel, que usa o mesmo schema no preview.
 */
export class CreateMaturationPlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsArray()
  @ArrayMinSize(2)
  @IsUUID(undefined, { each: true })
  instanceIds!: string[];

  @IsObject()
  config!: Record<string, unknown>;
}
