import { IsIn, IsOptional } from 'class-validator';

export class SetInstanceSettingsDto {
  /** Política de exposição do remoteJid. */
  @IsOptional() @IsIn(['phone', 'lid', 'auto'])
  identityMode?: 'phone' | 'lid' | 'auto';
}
