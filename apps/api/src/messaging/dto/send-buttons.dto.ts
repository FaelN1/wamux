import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { CanonicalButton } from '@wamux/shared';

export class SendButtonsDto {
  @IsString() @IsNotEmpty() to!: string;
  @IsString() @IsNotEmpty() text!: string;
  @IsOptional() @IsString() footer?: string;

  // WhatsApp aceita no máx. 3 botões de resposta.
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(3)
  buttons!: CanonicalButton[];

  @IsOptional() @IsBoolean() fallbackToText?: boolean;
  @IsOptional() @IsString() clientMessageId?: string;
}
