import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class ContactCardDto {
  @ApiProperty({ description: 'Nome completo exibido no cartão.', example: 'Maria Silva' })
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  /** número em dígitos (E.164 sem '+'). */
  @ApiPropertyOptional({
    description: "Número em dígitos (E.164 sem '+'). Usado para montar o TEL do vCard.",
    example: '5511988887777',
  })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Organização/empresa do contato.', example: 'ACME Ltda' })
  @IsOptional()
  @IsString()
  organization?: string;

  /** vCard cru; se presente, tem precedência sobre os campos acima. */
  @ApiPropertyOptional({
    description: 'vCard cru; quando presente, tem precedência sobre os campos acima.',
  })
  @IsOptional()
  @IsString()
  vcard?: string;
}

export class SendContactDto {
  @ApiProperty({
    description: 'Destino: número em dígitos (5511999999999) ou jid completo do WhatsApp.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({
    description: 'Um ou mais cartões de contato (mínimo 1).',
    type: [ContactCardDto],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContactCardDto)
  contacts!: ContactCardDto[];

  @ApiPropertyOptional({ description: 'id de uma mensagem para citar (reply).' })
  @IsOptional()
  @IsString()
  quotedMessageId?: string;

  /** id do cliente para idempotência (dedup de reenvio). */
  @ApiPropertyOptional({
    description: 'id do cliente para idempotência (reenvio com o mesmo valor não duplica).',
  })
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
