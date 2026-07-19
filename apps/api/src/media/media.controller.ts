import { Controller, Get, Param, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { Response } from 'express';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { MediaService } from './media.service';

@ApiTags('Mídia')
@ApiSecurity('apikey')
@Controller('messages')
@UseGuards(InstanceApiKeyGuard)
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':id/media/:messageId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Baixa a mídia de uma mensagem recebida (streaming ou base64).' })
  async download(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Query('includeBase64') includeBase64: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.media.fetchStored(id, messageId, includeBase64 === 'true');
    if (out.base64) return { mimetype: out.mimetype, base64: out.base64 };
    if (out.mimetype) res.setHeader('Content-Type', out.mimetype);
    // `length` explícito evita Transfer-Encoding: chunked — sem ele, o
    // <audio>/<video> do Chrome fica preso em readyState=0 (nunca toca)
    // mesmo com os bytes chegando certos, por falta de Content-Length.
    return new StreamableFile(out.stream!, { length: out.size });
  }
}
