import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

class ContactCardDto {
  @IsString()
  @IsNotEmpty()
  fullName!: string;

  /** número em dígitos (E.164 sem '+'). */
  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  organization?: string;

  /** vCard cru; se presente, tem precedência sobre os campos acima. */
  @IsOptional()
  @IsString()
  vcard?: string;
}

export class SendContactDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ContactCardDto)
  contacts!: ContactCardDto[];

  @IsOptional()
  @IsString()
  quotedMessageId?: string;

  /** id do cliente para idempotência (dedup de reenvio). */
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
