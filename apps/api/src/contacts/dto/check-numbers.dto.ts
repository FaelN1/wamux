import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsString } from 'class-validator';

export class CheckNumbersDto {
  /** teto duplicado no service (fonte de verdade); aqui é a 1ª barreira. */
  @IsArray() @ArrayNotEmpty() @ArrayMaxSize(20)
  @IsString({ each: true })
  numbers!: string[];
}
