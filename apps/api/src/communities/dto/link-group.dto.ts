import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LinkGroupDto {
  @ApiProperty({
    description: 'jid do grupo existente (…@g.us) a vincular como subgrupo da comunidade.',
    example: '120363012345678901@g.us',
  })
  @IsString()
  @IsNotEmpty()
  groupJid!: string;
}
