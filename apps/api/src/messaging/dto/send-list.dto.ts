import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListSection } from '@wamux/shared';

export class SendListDto {
  @ApiProperty({
    description: 'Destino: número em dígitos (5511999999999) ou jid completo do WhatsApp.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ description: 'Texto/corpo da mensagem.', example: 'Veja nosso cardápio:' })
  @IsString()
  @IsNotEmpty()
  text!: string;

  @ApiProperty({ description: 'Rótulo do botão que abre a lista.', example: 'Ver opções' })
  @IsString()
  @IsNotEmpty()
  buttonText!: string;

  @ApiProperty({
    description:
      'Seções da lista (mínimo 1). Cada seção: { title?, rows[] { id, title, description? } }.',
    type: 'array',
    minItems: 1,
    items: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              description: { type: 'string' },
            },
          },
        },
      },
    },
    example: [
      { title: 'Bebidas', rows: [{ id: 'coke', title: 'Coca-Cola', description: 'Lata 350ml' }] },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  sections!: ListSection[];

  @ApiPropertyOptional({ description: 'Título opcional da mensagem.', example: 'Cardápio' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Rodapé opcional.', example: 'Preços sujeitos a alteração' })
  @IsOptional()
  @IsString()
  footer?: string;

  @ApiPropertyOptional({
    description: 'Degrada para texto formatado quando a engine não entrega listas.',
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
