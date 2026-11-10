import { Body, Controller, Logger, Param, Post, Req, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { FlowsService } from './flows.service';

/**
 * Endpoint de troca de dados dos WhatsApp Flows (Data API). É a URL que vai em
 * `endpoint_uri` do Flow: a Meta chama aqui com o payload CIFRADO; o gateway
 * autentica, decifra, consulta o serviço do integrador e responde cifrado.
 *
 * Pública (a Meta não envia apikey) — autenticada por `X-Hub-Signature-256` e
 * pela própria criptografia (só quem tem a chave privada do número responde).
 * VERSION_NEUTRAL: URL fixa registrada fora do WAMux.
 */
@ApiTags('Webhooks de Entrada')
@Controller({ path: 'webhooks/flows', version: VERSION_NEUTRAL })
export class FlowEndpointController {
  private readonly logger = new Logger(FlowEndpointController.name);

  constructor(private readonly svc: FlowsService) {}

  @Post(':id')
  @ApiOperation({
    summary: 'Endpoint de troca de dados de Flows (chamado pela Meta)',
    description:
      'Recebe `{encrypted_flow_data, encrypted_aes_key, initial_vector}` e devolve a resposta ' +
      'cifrada em base64 (text/plain). Códigos do protocolo: 421 (não decifrável — a Meta ' +
      'recarrega a chave pública), 427 (flow_token inválido), 432 (assinatura inválida).',
  })
  @ApiParam({ name: 'id', description: 'ID (uuid) da instância Cloud dona do Flow.' })
  @ApiBody({ schema: { type: 'object', additionalProperties: true } })
  @ApiResponse({ status: 200, content: { 'text/plain': { schema: { type: 'string' } } } })
  async exchange(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    try {
      const out = await this.svc.dataExchange(id, {
        body,
        headers: req.headers,
        rawBody: (req as Request & { rawBody?: Buffer }).rawBody,
      });
      res.status(out.status).type('text/plain').send(out.body);
    } catch (e) {
      // Qualquer falha de negócio vira 500 sem corpo: a Meta mostra erro
      // genérico ao usuário e contabiliza no endpoint_error_rate do Flow.
      this.logger.error(`[${id}] troca de dados de Flow falhou: ${(e as Error).message}`);
      res.status(500).type('text/plain').send('');
    }
  }
}
