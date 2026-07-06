import { IsNotEmpty, IsString } from 'class-validator';

export class JoinGroupDto {
  /** código do convite ou link completo (chat.whatsapp.com/...). */
  @IsString() @IsNotEmpty() code!: string;
}
