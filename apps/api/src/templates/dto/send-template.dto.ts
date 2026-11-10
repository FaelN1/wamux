import { IsArray, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateSendComponent } from '@wamux/shared';

export class SendTemplateDto {
  @ApiProperty({
    description: 'Destinatário (número E.164 ou JID).',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ description: 'Nome do template (já aprovado).', example: 'pedido_confirmado' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  /** código da língua, ex.: pt_BR. */
  @ApiProperty({ description: 'Código da língua (locale).', example: 'pt_BR' })
  @IsString()
  @IsNotEmpty()
  language!: string;

  /** parâmetros de body/header/button (preenchimento). */
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Parâmetros de body/header/button (preenchimento das variáveis).',
    example: [{ type: 'body', parameters: [{ type: 'text', text: 'Maria' }] }],
  })
  @IsOptional()
  @IsArray()
  components?: TemplateSendComponent[];

  @ApiPropertyOptional({
    description: 'ID de uma mensagem a citar (reply).',
    example: 'wamid.HBgM...',
  })
  @IsOptional()
  @IsString()
  quotedMessageId?: string;
}
