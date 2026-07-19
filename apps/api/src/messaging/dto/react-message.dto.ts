import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReactMessageDto {
  /** chat da mensagem-alvo (jid ou número). */
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** id da mensagem-alvo. */
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  /** emoji; string vazia REMOVE a reação. */
  @IsString()
  emoji!: string;

  /** a mensagem-alvo foi enviada por nós? (default false). */
  @IsOptional()
  @IsBoolean()
  fromMe?: boolean;

  /** em grupo: jid do autor da mensagem-alvo. */
  @IsOptional()
  @IsString()
  participant?: string;
}
