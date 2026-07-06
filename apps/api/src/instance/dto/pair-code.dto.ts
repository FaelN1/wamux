import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class PairCodeDto {
  /** telefone em E.164 (só dígitos e opcional '+'). */
  @IsString() @IsNotEmpty()
  @Matches(/^\+?\d{8,15}$/, { message: 'phone deve ser um número E.164 (só dígitos, opcional +)' })
  phone!: string;
}
