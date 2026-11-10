import { IsNotEmpty, IsString, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PairCodeDto {
  @ApiProperty({
    description: 'Telefone em E.164 (só dígitos, com "+" opcional).',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^\+?\d{8,15}$/, { message: 'phone deve ser um número E.164 (só dígitos, opcional +)' })
  phone!: string;
}
