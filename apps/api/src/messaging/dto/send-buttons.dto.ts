import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CanonicalButton } from '@wamux/shared';

export class SendButtonsDto {
  @ApiProperty({
    description: 'Destino: número em dígitos (5511999999999) ou jid completo do WhatsApp.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ description: 'Texto/corpo da mensagem.', example: 'Escolha uma opção:' })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiPropertyOptional({ description: 'Rodapé opcional.', example: 'Atendimento 24h' })
  @IsOptional()
  @IsString()
  footer?: string;

  // WhatsApp aceita no máx. 3 botões de resposta.
  @ApiProperty({
    description:
      'Botões (mínimo 1, máximo 3). União discriminada por "type": ' +
      'reply {type,id,title} | url {type,title,url} | call {type,title,phone}.',
    type: 'array',
    minItems: 1,
    maxItems: 3,
    items: {
      oneOf: [
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['reply'] },
            id: { type: 'string' },
            title: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['url'] },
            title: { type: 'string' },
            url: { type: 'string' },
          },
        },
        {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['call'] },
            title: { type: 'string' },
            phone: { type: 'string' },
          },
        },
      ],
    },
    example: [
      { type: 'reply', id: 'sim', title: 'Sim' },
      { type: 'reply', id: 'nao', title: 'Não' },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  buttons!: CanonicalButton[];

  @ApiPropertyOptional({
    description: 'Degrada para texto formatado quando a engine não entrega botões.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  fallbackToText?: boolean;

  @ApiPropertyOptional({
    description: 'id do cliente para idempotência (reenvio com o mesmo valor não duplica).',
  })
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
