import { IsNotEmpty, IsString } from 'class-validator';

export class UpdateFlowJsonDto {
  /** conteúdo do flow.json como string. */
  @IsString()
  @IsNotEmpty()
  flowJson!: string;
}
