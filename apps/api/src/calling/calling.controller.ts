import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction, MessageAckStatus } from '@wamux/shared';
import { ID_PARAM, OK_SCHEMA } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { CallingService } from './calling.service';
import { ConnectCallDto, RequestPermissionDto } from './dto/calling.dto';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

/** Descrição do 501 uniforme lançado quando a engine não é a Cloud (Meta) oficial. */
const NOT_CLOUD =
  'A engine da instância não suporta chamadas (exclusivas da Cloud Calling API oficial da Meta).';

/** Resultado de envio de mensagem (SendResult) — devolvido no pedido de permissão. */
const SEND_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'id da mensagem enviada' },
    to: { type: 'string', description: 'destinatário (só dígitos)' },
    timestamp: { type: 'number', description: 'unix (s)' },
    status: { type: 'string', enum: ['sent', 'queued'] },
    ack: {
      type: 'string',
      enum: Object.values(MessageAckStatus),
      description: 'ack inicial (a entrega real é confirmada por evento)',
    },
    fallbackUsed: { type: 'boolean', description: 'interativo degradou para texto' },
  },
};

/** Configurações de calling do número (Cloud) — corpo/resposta são passthrough da Meta. */
const CALLING_SETTINGS_SCHEMA: SchemaObject = {
  type: 'object',
  description:
    'Configurações de calling do número na Cloud API (encaminhadas como passthrough para a Meta). ' +
    'Manter SIP desabilitado, senão /calls e webhooks de calling param de funcionar.',
  properties: {
    status: { type: 'string', description: 'ENABLED | DISABLED', enum: ['ENABLED', 'DISABLED'] },
    call_icon_visibility: { type: 'string', description: 'visibilidade do ícone de chamada' },
    call_hours: { type: 'object', description: 'janela de horários em que chamadas são aceitas' },
    callback_permission_status: { type: 'string' },
    sip: { type: 'object', description: 'config SIP (manter desabilitado)' },
  },
};

@ApiTags('Calling (Cloud)')
@ApiSecurity('apikey')
@ApiParam(ID_PARAM)
@Controller('instances/:id/calling')
@UseGuards(InstanceApiKeyGuard)
export class CallingController {
  constructor(private readonly svc: CallingService) {}

  @Post('settings')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Configura o calling do número',
    description:
      'Define as configurações de calling (status, call_hours, callback). 501 nas engines não-Cloud.',
  })
  @ApiBody({ schema: CALLING_SETTINGS_SCHEMA })
  @ApiOkResponse({ description: 'Configurações aplicadas.', schema: OK_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  async configure(@Param('id') id: string, @Body() settings: Record<string, unknown>) {
    await this.svc.configure(id, settings);
    return { ok: true };
  }

  @Get('settings')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lê as configurações de calling',
    description: 'Retorna as configurações de calling atuais do número.',
  })
  @ApiOkResponse({ description: 'Configurações de calling.', schema: CALLING_SETTINGS_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  getSettings(@Param('id') id: string) {
    return this.svc.getSettings(id);
  }

  @Post('permission-request')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Pede permissão de chamada',
    description: 'Envia um pedido de permissão de chamada ao usuário (abre a janela de 24h).',
  })
  @ApiCreatedResponse({ description: 'Pedido de permissão enviado.', schema: SEND_RESULT_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  requestPermission(@Param('id') id: string, @Body() dto: RequestPermissionDto) {
    return this.svc.requestPermission(id, dto.to, dto.text);
  }

  @Get('permission')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Consulta a permissão de chamada',
    description: 'Consulta o status de permissão de chamada de um usuário.',
  })
  @ApiQuery({
    name: 'waId',
    description: 'Número/wa_id do usuário cuja permissão se quer consultar.',
    example: '5511999999999',
  })
  @ApiOkResponse({
    description: 'Resposta bruta da Graph API com o status da permissão de chamada.',
    schema: { type: 'object', description: 'call_permissions da Cloud API' },
  })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  getPermission(@Param('id') id: string, @Query('waId') waId: string) {
    return this.svc.getPermission(id, waId);
  }

  @Post('action')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Ciclo da chamada',
    description:
      'Executa uma ação do ciclo da chamada: connect/pre_accept/accept/reject/terminate.',
  })
  @ApiCreatedResponse({
    description: 'Ação processada — id da chamada quando aplicável.',
    schema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'id da chamada (quando aplicável)' } },
    },
  })
  @ApiResponse({ status: 501, description: NOT_CLOUD })
  action(@Param('id') id: string, @Body() dto: ConnectCallDto) {
    return this.svc.action(id, dto);
  }
}
