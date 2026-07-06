import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { ListSection } from '@wamux/shared';

export class SendListDto {
  @IsString() @IsNotEmpty() to!: string;
  @IsString() @IsNotEmpty() text!: string;
  @IsString() @IsNotEmpty() buttonText!: string;

  @IsArray() @ArrayMinSize(1)
  sections!: ListSection[];

  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() footer?: string;
  @IsOptional() @IsBoolean() fallbackToText?: boolean;
  @IsOptional() @IsString() clientMessageId?: string;
}
