import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateSubjectDto {
  @ApiProperty({
    description: 'Novo assunto (nome) do grupo.',
    example: 'Novo nome do grupo',
    maxLength: 100,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  subject!: string;
}
