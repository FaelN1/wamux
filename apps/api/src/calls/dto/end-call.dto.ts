import { ApiPropertyOptional } from '@nestjs/swagger';
import { VoiceCallEndReason } from '@wamux/shared';
import { IsBoolean, IsEnum, IsOptional } from 'class-validator';

export class EndCallDto {
  @ApiPropertyOptional({
    enum: VoiceCallEndReason,
    description:
      'Motivo enviado ao encerrar. Default: `user_ended` no /end e `declined` no /reject.',
  })
  @IsOptional()
  @IsEnum(VoiceCallEndReason)
  reason?: VoiceCallEndReason;
}

export class MuteCallDto {
  @ApiPropertyOptional({
    description: 'true silencia o áudio local; false reativa.',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  muted?: boolean;
}
