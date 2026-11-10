import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBase64, IsOptional, IsString, IsUrl } from 'class-validator';

/** Áudio a tocar numa chamada ativa. Informe `url` OU `base64`. */
export class PlayCallAudioDto {
  @ApiPropertyOptional({
    description: 'URL do áudio (mp3/wav/ogg — decodificado por ffmpeg).',
    example: 'https://exemplo.com/mensagem.mp3',
  })
  @IsOptional()
  @IsUrl()
  url?: string;

  @ApiPropertyOptional({ description: 'Alternativa à URL: o áudio em base64.' })
  @IsOptional()
  @IsString()
  @IsBase64()
  base64?: string;
}
