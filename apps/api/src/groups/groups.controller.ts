import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
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
import { ID_PARAM, JID_PARAM } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateParticipantsDto } from './dto/update-participants.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { UpdateDescriptionDto } from './dto/update-description.dto';
import { GroupSettingDto } from './dto/group-setting.dto';
import { JoinGroupDto } from './dto/join-group.dto';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

/** Descrição do 501 uniforme (engine sem `capabilities.groups`). */
const NOT_SUPPORTED = 'A engine da instância não suporta grupos (ex.: Cloud API).';

const GROUP_PARTICIPANT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: {
      type: 'string',
      description: 'jid do participante (…@s.whatsapp.net)',
      example: '5511999999999@s.whatsapp.net',
    },
    role: { type: 'string', enum: ['member', 'admin', 'superadmin'] },
  },
};

/** Forma canônica de um grupo (GroupInfo). */
const GROUP_INFO_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jid: {
      type: 'string',
      description: 'jid do grupo (…@g.us)',
      example: '120363012345678901@g.us',
    },
    subject: { type: 'string' },
    description: { type: 'string' },
    owner: { type: 'string', description: 'jid do criador/dono' },
    participants: { type: 'array', items: GROUP_PARTICIPANT_SCHEMA },
    size: { type: 'number', description: 'nº de participantes' },
    creation: { type: 'number', description: 'timestamp de criação (unix segundos)' },
    announce: { type: 'boolean', description: 'true = só admins enviam mensagens' },
    restrict: { type: 'boolean', description: 'true = só admins editam infos do grupo' },
    isCommunity: { type: 'boolean', description: 'grupo é uma comunidade (agrupador)' },
    inviteCode: { type: 'string', description: 'código de convite atual, quando conhecido' },
    pictureUrl: { type: 'string', description: 'URL da foto de perfil, quando disponível' },
  },
};

/** Resultado por participante de uma operação em massa (GroupParticipantResult). */
const GROUP_PARTICIPANT_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jid: { type: 'string', example: '5511999999999@s.whatsapp.net' },
    status: {
      type: 'string',
      description: 'código de status da engine (ex.: "200", "409", "403")',
    },
  },
};

/** Código + link de convite (chat.whatsapp.com/<code>). */
const INVITE_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    code: { type: 'string', description: 'código do convite', example: 'ABCdef123' },
    url: {
      type: 'string',
      description: 'link chat.whatsapp.com/<code> (vazio quando não há código)',
      example: 'https://chat.whatsapp.com/ABCdef123',
    },
  },
};

@ApiTags('Grupos')
@ApiSecurity('apikey')
@Controller('instances/:id/groups')
@UseGuards(InstanceApiKeyGuard)
export class GroupsController {
  constructor(private readonly svc: GroupsService) {}

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista os grupos de que a conta participa.' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: { type: 'array', items: GROUP_INFO_SCHEMA } })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post()
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Cria um grupo com participantes iniciais.' })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ description: 'Grupo criado.', schema: GROUP_INFO_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  create(@Param('id') id: string, @Body() dto: CreateGroupDto) {
    return this.svc.create(id, dto);
  }

  // Rota estática antes de :jid para não colidir com o param.
  @Post('join')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Entra num grupo por código ou link de convite.' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    description: 'jid do grupo em que entrou.',
    schema: {
      type: 'object',
      properties: { jid: { type: 'string', example: '120363012345678901@g.us' } },
    },
  })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  join(@Param('id') id: string, @Body() dto: JoinGroupDto) {
    return this.svc.join(id, dto.code);
  }

  @Get(':jid')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Metadados do grupo (participantes, admins, settings).' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: GROUP_INFO_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  metadata(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.metadata(id, jid);
  }

  @Post(':jid/participants')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Adiciona / remove / promove / rebaixa participantes.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiCreatedResponse({
    description: 'Status por participante alvo.',
    schema: { type: 'array', items: GROUP_PARTICIPANT_RESULT_SCHEMA },
  })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  participants(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: UpdateParticipantsDto,
  ) {
    return this.svc.updateParticipants(id, jid, dto.participants, dto.action);
  }

  @Put(':jid/subject')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Altera o assunto (nome) do grupo.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Assunto alterado — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  subject(@Param('id') id: string, @Param('jid') jid: string, @Body() dto: UpdateSubjectDto) {
    return this.svc.setSubject(id, jid, dto.subject);
  }

  @Put(':jid/description')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Altera a descrição do grupo.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Descrição alterada — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  description(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: UpdateDescriptionDto,
  ) {
    return this.svc.setDescription(id, jid, dto.description);
  }

  @Put(':jid/setting')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Ajusta quem envia (announce) e quem edita infos (locked).' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Configuração aplicada — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  setting(@Param('id') id: string, @Param('jid') jid: string, @Body() dto: GroupSettingDto) {
    return this.svc.setSetting(id, jid, dto.setting);
  }

  @Get(':jid/invite')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Código e link de convite do grupo.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: INVITE_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  invite(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.getInvite(id, jid);
  }

  @Delete(':jid/invite')
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({ summary: 'Revoga o convite atual e gera um novo.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Novo convite gerado.', schema: INVITE_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  revoke(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.revokeInvite(id, jid);
  }

  @Post(':jid/leave')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({ summary: 'Sai do grupo.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Saiu do grupo — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  leave(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.leave(id, jid);
  }
}
