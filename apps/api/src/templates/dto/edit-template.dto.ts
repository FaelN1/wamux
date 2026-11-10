import { IsArray, IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateComponent } from '@wamux/shared';

export class EditTemplateDto {
  @ApiPropertyOptional({
    enum: ['AUTHENTICATION', 'MARKETING', 'UTILITY'],
    description: 'Nova categoria do template.',
    example: 'MARKETING',
  })
  @IsOptional()
  @IsIn(['AUTHENTICATION', 'MARKETING', 'UTILITY'])
  category?: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';

  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Novos componentes (HEADER/BODY/FOOTER/BUTTONS).',
    example: [{ type: 'BODY', text: 'Olá {{1}}, novidades para você.' }],
  })
  @IsOptional()
  @IsArray()
  components?: TemplateComponent[];
}
