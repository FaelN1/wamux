import { IsBoolean, IsIn, IsNotEmpty, IsString } from 'class-validator';

export class SetLabelAssociationDto {
  @IsIn(['chat', 'contact'])
  targetType!: 'chat' | 'contact';

  /** jid do chat/contato (5511...@s.whatsapp.net | ...@g.us). */
  @IsString() @IsNotEmpty() targetId!: string;

  /** true = associar; false = desassociar. */
  @IsBoolean() on!: boolean;
}
