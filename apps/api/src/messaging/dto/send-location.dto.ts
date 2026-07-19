import { IsNotEmpty, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class SendLocationDto {
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  quotedMessageId?: string;

  /** id do cliente para idempotência (dedup de reenvio). */
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
