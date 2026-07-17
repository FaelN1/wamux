import { IsNotEmpty, IsString } from 'class-validator';

export class LinkGroupDto {
  /** jid do grupo existente (…@g.us) a vincular como subgrupo da comunidade. */
  @IsString() @IsNotEmpty() groupJid!: string;
}
