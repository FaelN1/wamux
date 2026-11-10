import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction } from '@wamux/shared';
import { ID_PARAM, OK_SCHEMA } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { FlowsService } from './flows.service';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowJsonDto } from './dto/update-flow-json.dto';
import { SendFlowDto } from './dto/send-flow.dto';
import { FlowMetricsQueryDto } from './dto/flow-metrics.query.dto';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

const FLOW_STATUSES = ['DRAFT', 'PUBLISHED', 'DEPRECATED', 'BLOCKED', 'THROTTLED'];
const FLOW_CATEGORIES = [
  'SIGN_UP',
  'SIGN_IN',
  'APPOINTMENT_BOOKING',
  'LEAD_GENERATION',
  'CONTACT_US',
  'CUSTOMER_SUPPORT',
  'SURVEY',
  'OTHER',
];

/** Forma canônica de um Flow. */
const FLOW_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string', example: 'agendamento_consulta' },
    status: { type: 'string', enum: FLOW_STATUSES },
    categories: { type: 'array', items: { type: 'string', enum: FLOW_CATEGORIES } },
    validation_errors: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: 'erros de validação do flow.json (quando houver)',
    },
    endpoint_uri: { type: 'string' },
    preview: {
      type: 'object',
      properties: {
        preview_url: { type: 'string' },
        expires_at: { type: 'string' },
      },
    },
  },
};

/** Resposta de POST / (createFlow). */
const CREATE_FLOW_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    validation_errors: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
};

/** Resposta de POST /:flowId/assets (updateFlowJson). */
const UPDATE_FLOW_JSON_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    validation_errors: { type: 'array', items: { type: 'object', additionalProperties: true } },
  },
};

/** Resposta de POST /send (SendResult). */
const SEND_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'id da mensagem enviada' },
    to: { type: 'string' },
    timestamp: { type: 'number', description: 'unix' },
    status: { type: 'string', enum: ['sent', 'queued'] },
    ack: { type: 'string', description: 'ack inicial (entrega real confirmada por evento)' },
    fallbackUsed: { type: 'boolean', description: 'true se degradou para texto' },
  },
};

/** Descrição do 501 uniforme das rotas Cloud-only. */
const CLOUD_ONLY_501 = {
  status: 501,
  description: 'A engine da instância não é a Cloud API oficial (só cloud suporta Flows).',
};

@ApiTags('Flows (Cloud)')
@ApiSecurity('apikey')
@Controller('instances/:id/flows')
@UseGuards(InstanceApiKeyGuard)
export class FlowsController {
  constructor(private readonly svc: FlowsService) {}

  // ── rota estática antes das param ──

  @Post('send')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia um Flow (interactive flow).',
    description: 'Envia a mensagem interativa que abre o Flow no chat do destinatário.',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ description: 'Mensagem enviada/enfileirada.', schema: SEND_RESULT_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  send(@Param('id') id: string, @Body() dto: SendFlowDto) {
    return this.svc.send(id, dto);
  }

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lista os Flows da WABA.',
    description: 'Lista todos os Flows da WABA.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    description: 'Flows da WABA.',
    schema: { type: 'array', items: FLOW_SCHEMA },
  })
  @ApiResponse(CLOUD_ONLY_501)
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post()
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Cria um Flow (opcionalmente já com flow_json e publish).',
    description: 'Cria um Flow; pode já enviar o flow_json e publicá-lo na criação.',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({
    description: 'Flow criado (com eventuais validation_errors).',
    schema: CREATE_FLOW_RESULT_SCHEMA,
  })
  @ApiResponse(CLOUD_ONLY_501)
  create(@Param('id') id: string, @Body() dto: CreateFlowDto) {
    return this.svc.create(id, dto);
  }

  @Get(':flowId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Detalhe de um Flow (com validation_errors/preview).',
    description: 'Retorna o Flow com seus validation_errors e preview (quando disponível).',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowId', description: 'ID do Flow.' })
  @ApiOkResponse({ description: 'Flow encontrado.', schema: FLOW_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  get(@Param('id') id: string, @Param('flowId') flowId: string) {
    return this.svc.get(id, flowId);
  }

  @Post(':flowId/assets')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Atualiza o flow.json (só DRAFT). Devolve validation_errors.',
    description: 'Substitui o flow.json de um Flow em DRAFT e devolve os validation_errors.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowId', description: 'ID do Flow.' })
  @ApiCreatedResponse({ description: 'flow.json atualizado.', schema: UPDATE_FLOW_JSON_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  updateJson(
    @Param('id') id: string,
    @Param('flowId') flowId: string,
    @Body() dto: UpdateFlowJsonDto,
  ) {
    return this.svc.updateJson(id, flowId, dto.flowJson);
  }

  @Post(':flowId/publish')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Publica o Flow (torna-se imutável).',
    description: 'Publica o Flow; a partir daí ele fica imutável.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowId', description: 'ID do Flow.' })
  @ApiCreatedResponse({ schema: OK_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  async publish(@Param('id') id: string, @Param('flowId') flowId: string) {
    await this.svc.publish(id, flowId);
    return { ok: true };
  }

  @Post(':flowId/deprecate')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Deprecia um Flow publicado.',
    description: 'Marca um Flow publicado como DEPRECATED.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowId', description: 'ID do Flow.' })
  @ApiCreatedResponse({ schema: OK_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  async deprecate(@Param('id') id: string, @Param('flowId') flowId: string) {
    await this.svc.deprecate(id, flowId);
    return { ok: true };
  }

  @Get(':flowId/metrics')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Métricas de um Flow.',
    description: 'Repassa a resposta de métricas da Graph API (Meta) sem normalizar.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowId', description: 'ID do Flow.' })
  @ApiOkResponse({
    description: 'Payload de métricas tal como a Graph API (Meta) devolve.',
    schema: {
      type: 'object',
      additionalProperties: true,
      description: 'Resposta bruta de metric.name(...) (Graph API) — shape não normalizado.',
    },
  })
  @ApiResponse(CLOUD_ONLY_501)
  metrics(
    @Param('id') id: string,
    @Param('flowId') flowId: string,
    @Query() q: FlowMetricsQueryDto,
  ) {
    return this.svc.metrics(id, flowId, q);
  }

  @Delete(':flowId')
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({
    summary: 'Apaga um Flow (só DRAFT).',
    description: 'Apaga um Flow em DRAFT.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowId', description: 'ID do Flow.' })
  @ApiOkResponse({ schema: OK_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  async remove(@Param('id') id: string, @Param('flowId') flowId: string) {
    await this.svc.remove(id, flowId);
    return { ok: true };
  }
}
