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

class PixDto {
  @IsString() @IsNotEmpty() key!: string;
  @IsIn(['phone', 'email', 'cpf', 'cnpj', 'evp']) keyType!: 'phone' | 'email' | 'cpf' | 'cnpj' | 'evp';
  @IsString() @IsNotEmpty() merchant!: string;
  @IsOptional() @IsString() code?: string;
}

export class SendPixDto {
  @IsString() @IsNotEmpty() to!: string;

  @IsObject() @ValidateNested() @Type(() => PixDto) pix!: PixDto;

  @IsOptional() @IsBoolean() fallbackToText?: boolean;
  @IsOptional() @IsString() clientMessageId?: string;
}
