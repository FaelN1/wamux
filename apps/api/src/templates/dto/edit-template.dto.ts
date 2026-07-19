import { IsArray, IsIn, IsOptional } from 'class-validator';
import { TemplateComponent } from '@wamux/shared';

export class EditTemplateDto {
  @IsOptional()
  @IsIn(['AUTHENTICATION', 'MARKETING', 'UTILITY'])
  category?: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';

  @IsOptional()
  @IsArray()
  components?: TemplateComponent[];
}
