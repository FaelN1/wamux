import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class SetInstanceSettingsDto {
  @ApiPropertyOptional({
    enum: ['phone', 'lid', 'auto'],
    default: 'auto',
    description: 'Política de exposição do remoteJid nos eventos.',
  })
  @IsOptional()
  @IsIn(['phone', 'lid', 'auto'])
  identityMode?: 'phone' | 'lid' | 'auto';
}
