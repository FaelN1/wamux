import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SetPresenceDto {
  @ApiProperty({
    description: 'jid do destino (contato/chat) que verá a presença.',
    example: '5511999999999@s.whatsapp.net',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiProperty({
    description: 'Estado de presença a emitir.',
    enum: ['available', 'unavailable', 'composing', 'recording', 'paused'],
    example: 'composing',
  })
  @IsIn(['available', 'unavailable', 'composing', 'recording', 'paused'])
  state!: 'available' | 'unavailable' | 'composing' | 'recording' | 'paused';

  @ApiPropertyOptional({
    description: 'Por quanto tempo manter o estado (ms) antes de voltar a "paused" (0..60000).',
    example: 3000,
    minimum: 0,
    maximum: 60000,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60_000)
  durationMs?: number;
}
