import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class SendPollDto {
  @IsString() @IsNotEmpty() to!: string;
  @IsString() @IsNotEmpty() question!: string;

  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(12) @IsString({ each: true })
  options!: string[];

  /** quantas opções podem ser marcadas (default 1). */
  @IsOptional() @IsInt() @Min(1) @Max(12) selectableCount?: number;

  @IsOptional() @IsString() clientMessageId?: string;
}
