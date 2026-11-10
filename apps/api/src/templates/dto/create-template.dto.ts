import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateComponent } from '@wamux/shared';

export class CreateTemplateDto {
  @ApiProperty({
    description: 'Nome do template (minúsculas, sem espaços). Único na WABA.',
    example: 'pedido_confirmado',
  })
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** código da língua, ex.: pt_BR. */
  @ApiProperty({ description: 'Código da língua (locale).', example: 'pt_BR' })
  @IsString()
  @IsNotEmpty()
  language!: string;

  @ApiProperty({
    enum: ['AUTHENTICATION', 'MARKETING', 'UTILITY'],
    description: 'Categoria do template.',
    example: 'UTILITY',
  })
  @IsIn(['AUTHENTICATION', 'MARKETING', 'UTILITY'])
  category!: 'AUTHENTICATION' | 'MARKETING' | 'UTILITY';

  /** componentes (HEADER/BODY/FOOTER/BUTTONS) — a Meta valida o shape exato. */
  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Componentes (HEADER/BODY/FOOTER/BUTTONS) — a Meta valida o shape exato.',
    example: [{ type: 'BODY', text: 'Olá {{1}}, seu pedido foi confirmado.' }],
  })
  @IsArray()
  components!: TemplateComponent[];

  @ApiPropertyOptional({
    enum: ['POSITIONAL', 'NAMED'],
    description: 'Formato dos parâmetros do template ({{1}} vs {{nome}}).',
    example: 'POSITIONAL',
  })
  @IsOptional()
  @IsIn(['POSITIONAL', 'NAMED'])
  parameter_format?: 'POSITIONAL' | 'NAMED';

  @ApiPropertyOptional({
    description: 'Permite que a Meta reclassifique a categoria durante o review.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  allow_category_change?: boolean;
}
