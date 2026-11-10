import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction } from '@wamux/shared';
import { ID_PARAM } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { InstanceId } from '../common/instance-id.decorator';
import { KeyActions } from '../common/key-actions.decorator';
import { RequireScope } from '../common/require-scope.decorator';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

// ── Schemas de resposta (documentam "o que retorna" no OpenAPI) ──

/** Forma resumida de uma key (ApiKeySummary) — nunca carrega a key crua. */
const API_KEY_SUMMARY_PROPERTIES: Record<string, SchemaObject> = {
  id: { type: 'string', format: 'uuid' },
  label: { type: 'string', example: 'app-mobile' },
  keyPrefix: {
    type: 'string',
    description: 'primeiros 8 chars da key — só pra reconhecer, nunca a key inteira',
    example: 'wa_1a2b3',
  },
  actions: {
    type: 'array',
    items: { type: 'string', enum: Object.values(ApiKeyAction) },
  },
  createdAt: { type: 'number', description: 'unix (ms)' },
  lastUsedAt: { type: 'number', nullable: true, description: 'unix (ms) do último uso' },
  revoked: { type: 'boolean' },
};

const API_KEY_SUMMARY_SCHEMA: SchemaObject = {
  type: 'object',
  properties: API_KEY_SUMMARY_PROPERTIES,
};

/** Resposta da criação (CreateApiKeyResult) — ÚNICA vez que a key crua aparece. */
const CREATE_API_KEY_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    ...API_KEY_SUMMARY_PROPERTIES,
    key: {
      type: 'string',
      description: 'a key CRUA — só nesta resposta, nunca mais recuperável (guarde-a)',
      example: 'wa_1a2b3c4d5e6f...',
    },
  },
};

/**
 * Gestão de API keys escopadas da instância (§6 do design doc). Exige a
 * ação `app` — só quem já tem `app` pode criar/listar/revogar keys da
 * própria instância (key mestra e GLOBAL_API_KEY sempre têm `app`).
 */
@ApiTags('API Keys')
@ApiSecurity('apikey')
@Controller('instances/:id/api-keys')
@UseGuards(InstanceApiKeyGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Post()
  @RequireScope(ApiKeyAction.APP)
  @ApiOperation({
    summary: 'Cria uma API key escopada',
    description:
      'A key CRUA só aparece nesta resposta, uma vez. Não é possível conceder uma ação que a ' +
      'própria key criadora não tenha (anti-escalonamento §8).',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({
    description: 'Key criada — inclui a key crua (guarde-a, não é retornada de novo).',
    schema: CREATE_API_KEY_RESULT_SCHEMA,
  })
  async create(
    @InstanceId() instanceId: string,
    @KeyActions() callerActions: ApiKeyAction[],
    @Body() dto: CreateApiKeyDto,
  ) {
    // anti-escalonamento (§8): não dá pra conceder uma ação que a própria key não tem.
    const notAllowed = dto.actions.filter((a) => !callerActions.includes(a));
    if (notAllowed.length > 0) {
      throw new ForbiddenException(
        `Sua key não tem "${notAllowed.join(', ')}" — não pode conceder isso a uma key nova.`,
      );
    }
    return this.apiKeys.create(instanceId, dto);
  }

  @Get()
  @RequireScope(ApiKeyAction.APP)
  @ApiOperation({ summary: 'Lista as API keys escopadas da instância (nunca a key crua).' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    description: 'Keys escopadas da instância (mais recentes primeiro).',
    schema: { type: 'array', items: API_KEY_SUMMARY_SCHEMA },
  })
  list(@InstanceId() instanceId: string) {
    return this.apiKeys.list(instanceId);
  }

  @Delete(':keyId')
  @RequireScope(ApiKeyAction.APP)
  @ApiOperation({ summary: 'Revoga uma API key escopada (soft — mantém o histórico).' })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'keyId', description: 'ID (uuid) da API key a revogar.' })
  @ApiOkResponse({
    schema: { type: 'object', properties: { revoked: { type: 'boolean', example: true } } },
  })
  async revoke(@InstanceId() instanceId: string, @Param('keyId') keyId: string) {
    await this.apiKeys.revoke(instanceId, keyId);
    return { revoked: true };
  }
}
