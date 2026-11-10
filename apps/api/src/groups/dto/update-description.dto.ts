import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateDescriptionDto {
  @ApiProperty({
    description: 'Nova descrição do grupo. String vazia ("") limpa a descrição.',
    example: 'Regras e avisos do grupo.',
  })
  @IsString()
  description!: string;
}
