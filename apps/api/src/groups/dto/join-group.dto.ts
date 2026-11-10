import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinGroupDto {
  @ApiProperty({
    description: 'Código do convite ou link completo (chat.whatsapp.com/…).',
    example: 'https://chat.whatsapp.com/ABCdef123',
  })
  @IsString()
  @IsNotEmpty()
  code!: string;
}
