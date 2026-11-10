import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCommunityDescriptionDto {
  @ApiProperty({
    description: 'Nova descrição da comunidade. String vazia ("") remove a descrição.',
    example: 'Bem-vindos à comunidade oficial.',
  })
  @IsString()
  description!: string;
}
