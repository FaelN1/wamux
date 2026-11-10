import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl } from 'class-validator';

export class StartCallDto {
  @ApiProperty({
    description: 'Número (só dígitos, com DDI) ou jid do destino.',
    example: '5511999999999',
  })
  @IsString()
  @IsNotEmpty()
  to!: string;

  @ApiPropertyOptional({
    description:
      'Marca a chamada como vídeo na sinalização. A mídia de vídeo NÃO é transportada — só áudio.',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isVideo?: boolean;

  @ApiPropertyOptional({
    description: 'URL de um áudio a tocar assim que a chamada for atendida (precisa de ffmpeg).',
    example: 'https://exemplo.com/saudacao.mp3',
  })
  @IsOptional()
  @IsUrl()
  audioUrl?: string;
}
