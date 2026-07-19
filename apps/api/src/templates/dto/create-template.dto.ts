import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { TemplateComponent } from '@wamux/shared';

export class CreateTemplateDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** código da língua, ex.: pt_BR. */
  @IsString()
  @IsNotEmpty()
  language!: string;

  @IsIn(['AUTHENTICATION', 'MARKETING', 'UTILITY'])
  category!: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';

  /** componentes (HEADER/BODY/FOOTER/BUTTONS) — a Meta valida o shape exato. */
  @IsArray()
  components!: TemplateComponent[];

  @IsOptional()
  @IsIn(['POSITIONAL', 'NAMED'])
  parameter_format?: 'POSITIONAL' | 'NAMED';

  @IsOptional()
  @IsBoolean()
  allow_category_change?: boolean;
}
