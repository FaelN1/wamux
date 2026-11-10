import {
  Body,
  Controller,
  Delete,
  Get,
  GoneException,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import {
  ListFlowSessionsQueryDto,
  SetFlowEncryptionDto,
  SetFlowEndpointDto,
  UpdateFlowMetadataDto,
} from './dto/flow-config.dto';

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
    json_version: { type: 'string', example: '7.2', description: 'versão do Flow JSON' },
    data_api_version: { type: 'string', example: '3.0', description: 'versão da Data API' },
    health_status: {
      type: 'object',
      additionalProperties: true,
      description: 'diagnóstico da Meta: o Flow pode ser enviado e o que o impede',
    },
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
    flowToken: {
      type: 'string',
      description: 'token de correlação desta execução (gerado se não informado)',
    },
  },
};

const ENCRYPTION_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    business_public_key: { type: 'string', description: 'chave pública registrada na Meta (PEM)' },
    business_public_key_signature_status: { type: 'string', example: 'VALID' },
    hasPrivateKey: { type: 'boolean', description: 'o gateway guarda a privada correspondente' },
  },
};

const ENDPOINT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    url: { type: 'string', nullable: true, description: 'serviço do integrador' },
    endpointUri: {
      type: 'string',
      nullable: true,
      description: 'URL do gateway a registrar como endpoint_uri do Flow (requer PUBLIC_BASE_URL)',
    },
  },
};

const SESSION_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    instanceId: { type: 'string' },
    flowToken: { type: 'string' },
    flowId: { type: 'string', nullable: true },
    flowName: { type: 'string', nullable: true },
    contact: { type: 'string', nullable: true },
    messageId: { type: 'string', nullable: true, description: 'mensagem que abriu o Flow' },
    status: { type: 'string', enum: ['sent', 'in_progress', 'completed', 'failed'] },
    lastScreen: { type: 'string', nullable: true },
    lastAction: { type: 'string', nullable: true },
    exchanges: { type: 'number' },
    response: { type: 'object', nullable: true, additionalProperties: true },
    responseMessageId: { type: 'string', nullable: true },
    error: { type: 'object', nullable: true, additionalProperties: true },
    createdAt: { type: 'string' },
    updatedAt: { type: 'string' },
    completedAt: { type: 'string', nullable: true },
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

  @Get('encryption')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Chave pública de criptografia registrada para o número.',
    description:
      'Estado da chave na Meta (`business_public_key_signature_status`) e se o gateway ' +
      'guarda a privada correspondente. A chave privada nunca é devolvida.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: ENCRYPTION_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  getEncryption(@Param('id') id: string) {
    return this.svc.getEncryption(id);
  }

  @Put('encryption')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Gera (ou importa) o par de chaves e registra a pública na Meta.',
    description:
      'Necessário para Flows com endpoint. Sem corpo: gera RSA-2048. Com `privateKey`: importa a ' +
      'sua. Trocar a chave invalida a anterior para novas sessões de Flow.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: ENCRYPTION_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  setEncryption(@Param('id') id: string, @Body() dto: SetFlowEncryptionDto) {
    return this.svc.setEncryption(id, dto);
  }

  @Get('endpoint')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Configuração do endpoint de troca de dados.',
    description:
      '`endpointUri` é a URL do gateway a registrar no Flow; `url` é o seu serviço, que recebe ' +
      'o payload já decifrado e responde com a próxima tela.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: ENDPOINT_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  getEndpoint(@Param('id') id: string) {
    return this.svc.getEndpoint(id);
  }

  @Put('endpoint')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Define o serviço do integrador para a troca de dados.',
    description:
      'O gateway faz POST com `{instanceId, version, action, screen, data, flowToken}` (assinado ' +
      'com `X-WAMux-Signature` se houver webhook secret) e espera em JSON o corpo de resposta da ' +
      'Data API. Responda HTTP 427 com `{error_msg}` para invalidar o flow_token.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: ENDPOINT_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  setEndpoint(@Param('id') id: string, @Body() dto: SetFlowEndpointDto) {
    return this.svc.setEndpoint(id, dto.url);
  }

  @Get('sessions')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Execuções de Flow (correlação por flowToken).',
    description: 'Lista as sessões mais recentes; pagine com `before` (createdAt do último item).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: { type: 'array', items: SESSION_SCHEMA } })
  listSessions(@Param('id') id: string, @Query() q: ListFlowSessionsQueryDto) {
    return this.svc.listSessions(id, q);
  }

  @Get('sessions/:flowToken')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Uma execução de Flow pelo flowToken.',
    description: 'Estado, contato, mensagem enviada e resposta final (quando concluída).',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowToken', description: 'Token de correlação da execução.' })
  @ApiOkResponse({ schema: SESSION_SCHEMA })
  getSession(@Param('id') id: string, @Param('flowToken') flowToken: string) {
    return this.svc.getSession(id, flowToken);
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

  @Patch(':flowId')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Atualiza metadados do Flow (nome, categorias, endpoint_uri, app).',
    description: 'Só em DRAFT. Para alterar um Flow publicado, clone-o (`clone_flow_id`).',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowId', description: 'ID do Flow.' })
  @ApiOkResponse({ schema: OK_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  async updateMetadata(
    @Param('id') id: string,
    @Param('flowId') flowId: string,
    @Body() dto: UpdateFlowMetadataDto,
  ) {
    await this.svc.updateMetadata(id, flowId, dto);
    return { ok: true };
  }

  @Get(':flowId/assets')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Assets do Flow (Flow JSON vigente, com URL temporária de download).',
    description: 'Repassa a lista de assets da Graph API.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowId', description: 'ID do Flow.' })
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', example: 'flow.json' },
          asset_type: { type: 'string', example: 'FLOW_JSON' },
          download_url: { type: 'string' },
        },
      },
    },
  })
  @ApiResponse(CLOUD_ONLY_501)
  assets(@Param('id') id: string, @Param('flowId') flowId: string) {
    return this.svc.assets(id, flowId);
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
    summary: 'Métricas de um Flow (descontinuado pela Meta).',
    deprecated: true,
    description:
      'A Flows Metrics API foi descontinuada pela Meta em 2026-04-30. Responde 410 — acompanhe ' +
      'a saúde pelo evento `flow.status_update` e por `health_status` em GET :flowId.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'flowId', description: 'ID do Flow.' })
  @ApiResponse({ status: 410, description: 'Recurso descontinuado pela Meta.' })
  metrics(): never {
    throw new GoneException(
      'A Flows Metrics API foi descontinuada pela Meta em 2026-04-30. Use o evento flow.status_update e o campo health_status do Flow.',
    );
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
