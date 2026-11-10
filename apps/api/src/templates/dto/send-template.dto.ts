import { IsArray, IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MarketingProductPolicy, TemplateSendComponent, TemplateSendRoute } from '@wamux/shared';

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

  @ApiPropertyOptional({
    enum: ['cloud', 'marketing'],
    default: 'cloud',
    description:
      '`cloud` envia por `/messages`. `marketing` envia pela Marketing Messages API ' +
      '(`/marketing_messages`): só templates MARKETING, exige o aceite dos termos da MM API no ' +
      'App Dashboard. A Meta deixa de aceitar marketing em `/messages` em 2027-10-13.',
  })
  @IsOptional()
  @IsIn(['cloud', 'marketing'])
  route?: TemplateSendRoute;

  @ApiPropertyOptional({
    enum: ['CLOUD_API_FALLBACK', 'STRICT'],
    description:
      'Só com `route: marketing`. `STRICT` impede a Meta de entregar pela Cloud API quando o ' +
      'onboarding da MM API não está completo (default da Meta: `CLOUD_API_FALLBACK`).',
  })
  @IsOptional()
  @IsIn(['CLOUD_API_FALLBACK', 'STRICT'])
  productPolicy?: MarketingProductPolicy;

  @ApiPropertyOptional({
    description:
      'Só com `route: marketing`: compartilha a atividade da mensagem com a Meta. Omitido = ' +
      'vale a configuração da conta.',
  })
  @IsOptional()
  @IsBoolean()
  messageActivitySharing?: boolean;
}
