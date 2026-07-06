import { IsString } from 'class-validator';

export class UpdateDescriptionDto {
  /** vazio ('') limpa a descrição. */
  @IsString() description!: string;
}
