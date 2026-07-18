import { Controller, Get, Param, Res, StreamableFile } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { MediaService } from './media.service';

/**
 * Serve mídia de SAÍDA — SEM guard de apikey de propósito: o próprio
 * engine (ex. Baileys) faz um fetch HTTP puro dessa URL pra relayar ao
 * WhatsApp, o mesmo modelo de confiança de uma URL externa qualquer
 * (ex. https://picsum.photos/...). Segurança vem do uuid não-adivinhável
 * no path, não de auth. Ver LocalMediaStore.url().
 */
@ApiTags('Mídia')
@Controller('media/outbound')
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':instanceId/:key')
  @ApiOperation({ summary: 'Baixa mídia de saída (composer/API) — rota pública, sem apikey.' })
  async download(
    @Param('instanceId') instanceId: string,
    @Param('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.media.fetchStoredOutbound(instanceId, key);
    if (out.mimetype) res.setHeader('Content-Type', out.mimetype);
    // `length` explícito evita Transfer-Encoding: chunked — sem ele, o
    // <audio>/<video> do Chrome fica preso em readyState=0 (nunca toca)
    // mesmo com os bytes chegando certos, por falta de Content-Length.
    return new StreamableFile(out.stream, { length: out.size });
  }
}
