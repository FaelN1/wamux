import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
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
import { CloudGroupsService } from './cloud-groups.service';
import { CreateCloudGroupDto, RemoveParticipantDto } from './dto/cloud-group.dto';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

/** Forma canônica de um grupo (GroupInfo). */
const GROUP_INFO_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jid: { type: 'string', description: 'jid do grupo (…@g.us)', example: '1234567890@g.us' },
    subject: { type: 'string', example: 'Clientes VIP' },
    description: { type: 'string' },
    owner: { type: 'string', description: 'jid do criador/dono' },
    participants: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'jid do participante' },
          role: { type: 'string', enum: ['member', 'admin', 'superadmin'] },
        },
      },
    },
    size: { type: 'number' },
    creation: { type: 'number', description: 'unix (segundos)' },
    announce: { type: 'boolean', description: 'true = só admins enviam' },
    restrict: { type: 'boolean', description: 'true = só admins editam infos' },
    isCommunity: { type: 'boolean' },
    inviteCode: { type: 'string' },
    pictureUrl: { type: 'string' },
  },
};

/** Resposta de GET/POST /:groupId/invite ({ code, url }). */
const INVITE_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    code: { type: 'string', description: 'código de convite' },
    url: { type: 'string', description: 'link de convite completo' },
  },
};

/** Descrição do 501 uniforme das rotas Cloud-only. */
const CLOUD_ONLY_501 = {
  status: 501,
  description: 'A engine da instância não é a Cloud API oficial (só cloud suporta a Groups API).',
};

@ApiTags('Grupos Cloud')
@ApiSecurity('apikey')
@Controller('instances/:id/cloud-groups')
@UseGuards(InstanceApiKeyGuard)
export class CloudGroupsController {
  constructor(private readonly svc: CloudGroupsService) {}

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lista os grupos da Cloud API (OBA-gated, máx 8).',
    description: 'Lista os grupos da Groups API (Cloud). Recurso OBA-gated, limite de 8 grupos.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    description: 'Grupos da Cloud API.',
    schema: { type: 'array', items: GROUP_INFO_SCHEMA },
  })
  @ApiResponse(CLOUD_ONLY_501)
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post()
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Cria um grupo Cloud. (bodies a validar em conta real)',
    description: 'Cria um grupo na Groups API (Cloud), opcionalmente com participantes iniciais.',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ description: 'Grupo criado.', schema: GROUP_INFO_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  create(@Param('id') id: string, @Body() dto: CreateCloudGroupDto) {
    return this.svc.create(id, dto);
  }

  @Get(':groupId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Detalhe de um grupo Cloud.',
    description: 'Retorna as infos de um grupo da Groups API (Cloud).',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'groupId', description: 'ID do grupo Cloud.' })
  @ApiOkResponse({ description: 'Grupo encontrado.', schema: GROUP_INFO_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  get(@Param('id') id: string, @Param('groupId') groupId: string) {
    return this.svc.get(id, groupId);
  }

  @Get(':groupId/invite')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Link de convite do grupo.',
    description: 'Retorna o código e o link de convite atuais do grupo.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'groupId', description: 'ID do grupo Cloud.' })
  @ApiOkResponse({ description: 'Convite atual.', schema: INVITE_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  invite(@Param('id') id: string, @Param('groupId') groupId: string) {
    return this.svc.invite(id, groupId);
  }

  @Post(':groupId/invite')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Reseta o link de convite.',
    description: 'Revoga o convite atual e gera um novo código/link.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'groupId', description: 'ID do grupo Cloud.' })
  @ApiCreatedResponse({ description: 'Novo convite.', schema: INVITE_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  resetInvite(@Param('id') id: string, @Param('groupId') groupId: string) {
    return this.svc.resetInvite(id, groupId);
  }

  @Post(':groupId/participants/remove')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Remove um participante do grupo.',
    description: 'Remove o participante indicado por waId do grupo.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'groupId', description: 'ID do grupo Cloud.' })
  @ApiCreatedResponse({ schema: OK_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  async removeParticipant(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() dto: RemoveParticipantDto,
  ) {
    await this.svc.removeParticipant(id, groupId, dto.waId);
    return { ok: true };
  }

  @Delete(':groupId')
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({
    summary: 'Apaga/sai do grupo Cloud.',
    description: 'Apaga o grupo (ou sai dele) na Groups API (Cloud).',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'groupId', description: 'ID do grupo Cloud.' })
  @ApiOkResponse({ schema: OK_SCHEMA })
  @ApiResponse(CLOUD_ONLY_501)
  async remove(@Param('id') id: string, @Param('groupId') groupId: string) {
    await this.svc.remove(id, groupId);
    return { ok: true };
  }
}
