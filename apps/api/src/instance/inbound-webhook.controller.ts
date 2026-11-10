import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { InstanceManagerService } from './instance-manager.service';

/**
 * Recepção de webhooks de ENTRADA dos providers que não têm socket próprio:
 *  - Cloud API (Meta) entrega mensagens/status aqui.
 *  - whatsmeow (sidecar wuzapi) entrega mensagens aqui.
 *
 * O payload é repassado ao provider da instância, que normaliza e emite o
 * evento `message` — daí segue o mesmo fluxo do Baileys/webjs.
 *
 * Estas rotas são públicas (Meta/wuzapi não enviam nossa API key) — daí NÃO
 * levam @ApiSecurity('apikey'); a autenticação é feita por verify_token
 * (Cloud) ou token compartilhado do sidecar.
 *
 * VERSION_NEUTRAL: URLs fixas configuradas fora do WAMux (Meta/sidecar) —
 * não ganham /v1.
 */
@ApiTags('Webhooks de Entrada')
@Controller({ path: 'webhooks', version: VERSION_NEUTRAL })
export class InboundWebhookController {
  constructor(
    private readonly manager: InstanceManagerService,
    private readonly config: ConfigService,
  ) {}

  /** Verificação do webhook da Meta (handshake GET). */
  @Get('cloud/:id')
  @ApiOperation({
    summary: 'Handshake de verificação do webhook da Meta (Cloud API)',
    description:
      'A Meta chama esta URL ao assinar o webhook. Devolve `hub.challenge` como texto puro ' +
      'quando `hub.verify_token` bate com o configurado; 403 caso contrário. Pública (sem apikey).',
  })
  @ApiParam({ name: 'id', description: 'ID (uuid) da instância Cloud alvo.' })
  @ApiQuery({ name: 'hub.mode', description: 'Deve ser "subscribe".', example: 'subscribe' })
  @ApiQuery({ name: 'hub.verify_token', description: 'Token esperado (cloudApi.verifyToken).' })
  @ApiQuery({ name: 'hub.challenge', description: 'Desafio ecoado de volta pela Meta.' })
  @ApiOkResponse({
    description: 'Eco do `hub.challenge` (texto puro) quando o token confere.',
    content: { 'text/plain': { schema: { type: 'string' } } },
  })
  verifyCloud(
    @Param('id') _id: string,
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const expected = this.config.get<string>('cloudApi.verifyToken');
    if (mode === 'subscribe' && token && token === expected) {
      return challenge;
    }
    throw new ForbiddenException('verify_token inválido');
  }

  @Post('cloud/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recebe eventos do webhook da Meta (Cloud API)',
    description:
      'A Meta entrega mensagens/status aqui (payload no formato dela). Repassado ao provider ' +
      'para normalizar e emitir `message`. Pública (sem apikey) — auth por verify_token.',
  })
  @ApiParam({ name: 'id', description: 'ID (uuid) da instância Cloud alvo.' })
  @ApiBody({
    description: 'Payload do webhook da Meta (Cloud API) — formato próprio da Meta.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOkResponse({
    schema: { type: 'object', properties: { received: { type: 'boolean', example: true } } },
  })
  async inboundCloud(@Param('id') id: string, @Body() payload: unknown) {
    const provider = await this.manager.ensureConnected(id);
    await provider.handleInboundWebhook(payload, { source: 'cloud' });
    return { received: true };
  }

  @Post('whatsmeow/:id')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Recebe eventos do sidecar whatsmeow',
    description:
      'O sidecar (wuzapi) entrega mensagens aqui. Repassado ao provider para normalizar e ' +
      'emitir `message`. Pública (sem apikey) — auth por token compartilhado do sidecar.',
  })
  @ApiParam({ name: 'id', description: 'ID (uuid) da instância whatsmeow alvo.' })
  @ApiBody({
    description: 'Payload do webhook do sidecar whatsmeow — formato próprio do sidecar.',
    schema: { type: 'object', additionalProperties: true },
  })
  @ApiOkResponse({
    schema: { type: 'object', properties: { received: { type: 'boolean', example: true } } },
  })
  async inboundWhatsmeow(@Param('id') id: string, @Body() payload: unknown) {
    const provider = await this.manager.ensureConnected(id);
    await provider.handleInboundWebhook(payload, { source: 'whatsmeow' });
    return { received: true };
  }
}
