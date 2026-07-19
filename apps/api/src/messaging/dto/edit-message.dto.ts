import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class EditMessageDto {
  /** chat da mensagem-alvo (jid ou número). */
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** id da mensagem-alvo. */
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  /** novo texto. */
  @IsString()
  @IsNotEmpty()
  text!: string;

  /** a mensagem-alvo foi enviada por nós? (default true — só a própria é editável). */
  @IsOptional()
  @IsBoolean()
  fromMe?: boolean;

  /** em grupo: jid do autor da mensagem-alvo. */
  @IsOptional()
  @IsString()
  participant?: string;
}
