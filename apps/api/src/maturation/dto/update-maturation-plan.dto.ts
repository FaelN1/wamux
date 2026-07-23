import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

/** Patch de plano — só permitido quando o plano NÃO está rodando. */
export class UpdateMaturationPlanDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @IsUUID(undefined, { each: true })
  instanceIds?: string[];

  /** config SEMPRE completo (o painel envia o objeto inteiro), validado via zod. */
  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
