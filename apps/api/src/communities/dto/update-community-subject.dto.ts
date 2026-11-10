import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateCommunitySubjectDto {
  @ApiProperty({ description: 'Novo nome da comunidade.', example: 'Comunidade Renomeada' })
  @IsString()
  @IsNotEmpty()
  subject!: string;
}
