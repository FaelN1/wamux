import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateFlowJsonDto {
  /** conteúdo do flow.json como string. */
  @ApiProperty({
    description: 'Conteúdo do flow.json como string.',
    example: '{"version":"5.0","screens":[]}',
  })
  @IsString()
  @IsNotEmpty()
  flowJson!: string;
}
