import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendTextDto {
  /** destino: número (5511999999999) ou jid completo. */
  @IsString()
  @IsNotEmpty()
  to!: string;

  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  quotedMessageId?: string;

  @IsOptional()
  @IsBoolean()
  linkPreview?: boolean;

  /** id do cliente para idempotência (dedup de reenvio). */
  @IsOptional()
  @IsString()
  clientMessageId?: string;
}
