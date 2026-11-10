import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
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
import { ApiKeyAction } from '@wamux/shared';
import { ID_PARAM } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { EditTemplateDto } from './dto/edit-template.dto';
import { SendTemplateDto } from './dto/send-template.dto';
import { ListTemplatesQueryDto } from './dto/list-templates.query.dto';
import { TemplateAnalyticsQueryDto } from './dto/template-analytics.query.dto';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

const TEMPLATE_CATEGORIES = ['AUTHENTICATION', 'MARKETING', 'UTILITY'];
const TEMPLATE_STATUSES = [
  'PENDING',
  'IN_REVIEW',
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'DISABLED',
  'PENDING_DELETION',
  'APPEAL_REQUESTED',
];

/** Forma canônica de um template HSM (MessageTemplate). */
const MESSAGE_TEMPLATE_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string', example: 'pedido_confirmado' },
    language: { type: 'string', example: 'pt_BR' },
    category: { type: 'string', enum: TEMPLATE_CATEGORIES },
    status: { type: 'string', enum: TEMPLATE_STATUSES },
    quality_score: {
      type: 'string',
      enum: ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'],
      description: 'qualidade da mensagem (quando conhecida)',
    },
    components: {
      type: 'array',
      items: { type: 'object', additionalProperties: true },
      description: 'componentes HEADER/BODY/FOOTER/BUTTONS',
    },
    parameter_format: { type: 'string', enum: ['POSITIONAL', 'NAMED'] },
  },
};

/** Resposta de POST / (createTemplate — entra em review). */
const CREATE_TEMPLATE_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string', enum: TEMPLATE_STATUSES },
    category: { type: 'string', enum: TEMPLATE_CATEGORIES },
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
  description: 'A engine da instância não é a Cloud API oficial (só cloud suporta templates).',
};

@ApiTags('Templates (Cloud)')
@ApiSecurity('apikey')
@Controller('instances/:id/templates')
@UseGuards(InstanceApiKeyGuard)
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  // ── rotas estáticas antes das param (evita capturar 'analytics'/'send') ──

  @Get('analytics')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Analytics de templates (sent/delivered/read/clicked).',
    description: 'Repassa a resposta do template_analytics da Graph API (Meta) sem normalizar.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    description: 'Payload de analytics tal como a Graph API (Meta) devolve.',
    schema: {
      type: 'object',
      additionalProperties: true,
      description: 'Resposta bruta do template_analytics (Graph API) — shape não normalizado.',
    },
  })
  @ApiResponse(CLOUD_ONLY_501)
  analytics(@Param('id') id: string, @Query() q: TemplateAnalyticsQueryDto) {
    return this.svc.analytics(id, {
      start: q.start,
      end: q.end,
      templateIds: q.templateIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      metricTypes: q.metricTypes
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  @Post('send')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia um template (preenchendo os parâmetros).',
    description: 'Envia um template já aprovado, preenchendo as variáveis de body/header/button.',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ description: 'Mensagem enviada/enfileirada.', schema: SEND_RESULT_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  send(@Param('id') id: string, @Body() dto: SendTemplateDto) {
    return this.svc.send(id, dto);
  }

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lista templates (filtros: category/status/language/name).',
    description: 'Lista os templates da WABA, aplicando os filtros opcionais.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    description: 'Templates da WABA.',
    schema: { type: 'array', items: MESSAGE_TEMPLATE_SCHEMA },
  })
  @ApiResponse(CLOUD_ONLY_501)
  list(@Param('id') id: string, @Query() q: ListTemplatesQueryDto) {
    return this.svc.list(id, q as never);
  }

  @Post()
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Cria um template (entra em review na Meta).',
    description: 'Cria o template na WABA; ele entra em review na Meta antes de poder ser enviado.',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({
    description: 'Template criado (status inicial do review).',
    schema: CREATE_TEMPLATE_RESULT_SCHEMA,
  })
  @ApiResponse(CLOUD_ONLY_501)
  create(@Param('id') id: string, @Body() dto: CreateTemplateDto) {
    return this.svc.create(id, dto);
  }

  @Delete()
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({
    summary: 'Apaga um template por nome (todas as línguas) ou hsmId (1 locale).',
    description:
      'Sem hsmId apaga todas as línguas do nome; com hsmId apaga só aquele locale. Corpo vazio na resposta.',
  })
  @ApiParam(ID_PARAM)
  @ApiQuery({
    name: 'name',
    description: 'Nome do template a apagar.',
    example: 'pedido_confirmado',
  })
  @ApiQuery({
    name: 'hsmId',
    required: false,
    description: 'ID do template para apagar só UM locale (sem ele, apaga todas as línguas).',
  })
  @ApiOkResponse({ description: 'Template apagado (corpo vazio).' })
  @ApiResponse(CLOUD_ONLY_501)
  remove(@Param('id') id: string, @Query('name') name: string, @Query('hsmId') hsmId?: string) {
    return this.svc.remove(id, { name, hsmId });
  }

  @Get(':idOrName')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Detalhe de um template por id ou nome.',
    description: 'Retorna o template pelo seu id (hsmId) ou pelo nome.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'idOrName', description: 'ID (hsmId) ou nome do template.' })
  @ApiOkResponse({ description: 'Template encontrado.', schema: MESSAGE_TEMPLATE_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  get(@Param('id') id: string, @Param('idOrName') idOrName: string) {
    return this.svc.get(id, idOrName);
  }

  @Post(':templateId')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Edita category/components (só APPROVED/REJECTED).',
    description:
      'Edita a categoria e/ou os componentes de um template (permitido só em APPROVED/REJECTED). Corpo vazio na resposta.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'templateId', description: 'ID (hsmId) do template a editar.' })
  @ApiCreatedResponse({ description: 'Template editado (corpo vazio).' })
  @ApiResponse(CLOUD_ONLY_501)
  edit(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Body() dto: EditTemplateDto,
  ) {
    return this.svc.edit(id, templateId, dto);
  }
}
