import {
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class PixDto {
  @ApiProperty({ description: 'Chave PIX.', example: 'contato@empresa.com' })
  @IsString()
  @IsNotEmpty()
  key!: string;

  @ApiProperty({
    description: 'Tipo da chave PIX.',
    enum: ['phone', 'email', 'cpf', 'cnpj', 'evp'],
    example: 'email',
  })
  @IsIn(['phone', 'email', 'cpf', 'cnpj', 'evp'])
  keyType!: 'phone' | 'email' | 'cpf' | 'cnpj' | 'evp';

  @ApiProperty({ description: 'Nome do recebedor/estabelecimento.', example: 'Loja do João' })
  @IsString()
  @IsNotEmpty()
  merchant!: string;

  @ApiPropertyOptional({
    description: 'BR Code "copia e cola" (opcional; senão o cliente monta pela chave).',
  })
  @IsOptional()
  @IsString()
  code?: string;
}

export class SendPixDto {
  @ApiProperty({
    description: 'Destino: número em dígitos (5511999999999) ou jid completo do WhatsApp.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({ description: 'Dados do PIX (chave, tipo, recebedor, código).', type: PixDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PixDto)
  pix!: PixDto;

  @ApiPropertyOptional({
    description: 'Degrada para texto formatado quando a engine não entrega o botão PIX.',
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
