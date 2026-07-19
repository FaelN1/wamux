import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class DeleteMessageDto {
  /** chat da mensagem-alvo (jid ou número). */
  @IsString()
  @IsNotEmpty()
  to!: string;

  /** id da mensagem-alvo. */
  @IsString()
  @IsNotEmpty()
  messageId!: string;

  /** apagar para todos (revoke). false = só pra mim. Default true. */
  @IsOptional()
  @IsBoolean()
  forEveryone?: boolean;

  /** a mensagem-alvo foi enviada por nós? (default true). */
  @IsOptional()
  @IsBoolean()
  fromMe?: boolean;

  /** em grupo: jid do autor da mensagem-alvo. */
  @IsOptional()
  @IsString()
  participant?: string;
}
