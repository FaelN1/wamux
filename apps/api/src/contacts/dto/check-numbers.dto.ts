import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CheckNumbersDto {
  /** teto duplicado no service (fonte de verdade); aqui é a 1ª barreira. */
  @ApiProperty({
    type: [String],
    description: 'Números a checar (E.164 ou só dígitos). Teto de 20 por lote (anti-ban).',
    example: ['5511999999999', '5521888888888'],
    maxItems: 20,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  numbers!: string[];
}
