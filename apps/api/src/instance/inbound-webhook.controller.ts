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
import { ApiExcludeController } from '@nestjs/swagger';
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
 * Estas rotas são públicas (Meta/wuzapi não enviam nossa API key); a
 * autenticação é feita por verify_token (Cloud) ou token compartilhado.
 *
 * VERSION_NEUTRAL: URLs fixas configuradas fora do WAMux (Meta/sidecar) —
 * não ganham /v1. Excluídas do Swagger (não são superfície do cliente).
 */
@ApiExcludeController()
@Controller({ path: 'webhooks', version: VERSION_NEUTRAL })
export class InboundWebhookController {
  constructor(
    private readonly manager: InstanceManagerService,
    private readonly config: ConfigService,
  ) {}

  /** Verificação do webhook da Meta (handshake GET). */
  @Get('cloud/:id')
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
  async inboundCloud(@Param('id') id: string, @Body() payload: unknown) {
    const provider = await this.manager.ensureConnected(id);
    await provider.handleInboundWebhook(payload, { source: 'cloud' });
    return { received: true };
  }

  @Post('whatsmeow/:id')
  @HttpCode(200)
  async inboundWhatsmeow(@Param('id') id: string, @Body() payload: unknown) {
    const provider = await this.manager.ensureConnected(id);
    await provider.handleInboundWebhook(payload, { source: 'whatsmeow' });
    return { received: true };
  }
}
