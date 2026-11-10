import { Controller, Get, Param, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { Response } from 'express';
import { ID_PARAM } from '../common/openapi';
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
  @ApiOperation({
    summary: 'Baixa a mídia de uma mensagem recebida',
    description:
      'Por padrão faz streaming dos bytes (Content-Type + Content-Length). Com ' +
      'includeBase64=true retorna JSON { mimetype, base64 } em vez do stream.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'messageId', description: 'ID da mensagem recebida cuja mídia baixar.' })
  @ApiQuery({
    name: 'includeBase64',
    required: false,
    description: "Se 'true', retorna JSON { mimetype, base64 } em vez do stream binário.",
    example: 'true',
  })
  @ApiOkResponse({
    description: 'Bytes da mídia (stream) ou, com includeBase64=true, JSON { mimetype, base64 }.',
    content: {
      'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            mimetype: { type: 'string' },
            base64: { type: 'string', description: 'conteúdo da mídia em base64' },
          },
        },
      },
    },
  })
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
