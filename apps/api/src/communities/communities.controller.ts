import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction } from '@wamux/shared';
import { ID_PARAM, JID_PARAM } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunitySubjectDto } from './dto/update-community-subject.dto';
import { UpdateCommunityDescriptionDto } from './dto/update-community-description.dto';
import { UpdateCommunityImageDto } from './dto/update-community-image.dto';
import { UpdateCommunityAdminsDto } from './dto/update-community-admins.dto';
import { LinkGroupDto } from './dto/link-group.dto';
import { SendCommunityAnnouncementDto } from './dto/send-community-announcement.dto';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

/** Descrição do 501 uniforme (engine sem `capabilities.communities`). */
const NOT_SUPPORTED =
  'A engine da instância não suporta comunidades (ex.: WhatsApp Web JS ou Cloud API).';

const COMMUNITY_PARTICIPANT_SCHEMA: SchemaObject = {
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

/** Forma canônica de uma comunidade (CommunityInfo). */
const COMMUNITY_INFO_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jid: {
      type: 'string',
      description: 'jid da comunidade (…@g.us — é um tipo especial de grupo)',
      example: '120363012345678901@g.us',
    },
    subject: { type: 'string' },
    description: { type: 'string' },
    owner: { type: 'string', description: 'jid do criador/dono' },
    participants: { type: 'array', items: COMMUNITY_PARTICIPANT_SCHEMA },
    size: { type: 'number', description: 'nº de participantes' },
    creation: { type: 'number', description: 'timestamp de criação (unix segundos)' },
    announce: { type: 'boolean', description: 'true = só admins enviam no grupo-pai' },
    restrict: { type: 'boolean', description: 'true = só admins editam infos da comunidade' },
    announcementGroupJid: {
      type: 'string',
      nullable: true,
      description:
        'jid do subgrupo de anúncios — pode vir ausente logo após criar ' +
        '(resolução assíncrona via evento communities.announcement.discovered)',
    },
    defaultGroupJid: {
      type: 'string',
      description: 'jid do subgrupo padrão (Geral), quando conhecido',
    },
    pictureUrl: { type: 'string', description: 'URL da foto de perfil, quando disponível' },
  },
};

/** Subgrupo vinculado à comunidade (CommunityLinkedGroup). */
const COMMUNITY_LINKED_GROUP_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jid: { type: 'string', example: '120363012345678901@g.us' },
    subject: { type: 'string' },
    isAnnounce: {
      type: 'boolean',
      description: 'true = subgrupo de anúncios (write-restricted, só admins postam)',
    },
    size: { type: 'number', description: 'nº de participantes, quando conhecido' },
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

/** Resultado de um envio (SendResult) — usado no fanout de anúncios. */
const SEND_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'id da mensagem enviada' },
    to: { type: 'string', description: 'jid destino (grupo de anúncios da comunidade)' },
    timestamp: { type: 'number' },
    status: { type: 'string', enum: ['sent', 'queued'] },
    ack: { type: 'string', description: 'ack inicial; a entrega REAL é confirmada por evento' },
    fallbackUsed: {
      type: 'boolean',
      description: 'true quando o interativo degradou para texto',
    },
  },
};

@ApiTags('Comunidades')
@ApiSecurity('apikey')
@Controller('instances/:id/communities')
@UseGuards(InstanceApiKeyGuard)
export class CommunitiesController {
  constructor(private readonly svc: CommunitiesService) {}

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista as comunidades de que a conta participa.' })
  @ApiParam(ID_PARAM)
  @ApiQuery({
    name: 'onlyOwnedOrAdmin',
    required: false,
    type: Boolean,
    description:
      'Quando "true", filtra pra só as comunidades onde a própria conta é admin ou superadmin ' +
      '(exclui as em que é só membro comum). Sem o param, traz tudo (comportamento atual).',
  })
  @ApiOkResponse({ schema: { type: 'array', items: COMMUNITY_INFO_SCHEMA } })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  list(@Param('id') id: string, @Query('onlyOwnedOrAdmin') onlyOwnedOrAdmin?: string) {
    return this.svc.list(id, onlyOwnedOrAdmin === 'true');
  }

  @Post()
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Cria uma comunidade (grupo-pai).' })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ description: 'Comunidade criada.', schema: COMMUNITY_INFO_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  create(@Param('id') id: string, @Body() dto: CreateCommunityDto) {
    return this.svc.create(id, dto);
  }

  // Rota estática antes de :jid para não colidir com o param.
  @Post('sync')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Resincroniza todas as comunidades (metadados + participantes).' })
  @ApiParam(ID_PARAM)
  @ApiQuery({
    name: 'onlyOwnedOrAdmin',
    required: false,
    type: Boolean,
    description:
      'Mesmo filtro de GET / — só retorna as comunidades onde a conta é admin/superadmin.',
  })
  @ApiOkResponse({
    description: 'Comunidades resincronizadas.',
    schema: { type: 'array', items: COMMUNITY_INFO_SCHEMA },
  })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  syncAll(@Param('id') id: string, @Query('onlyOwnedOrAdmin') onlyOwnedOrAdmin?: string) {
    return this.svc.syncAll(id, onlyOwnedOrAdmin === 'true');
  }

  @Get(':jid')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Metadados da comunidade (participantes, grupo de anúncios, etc.).' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: COMMUNITY_INFO_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  metadata(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.metadata(id, jid);
  }

  @Delete(':jid')
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({
    summary:
      'Remove a comunidade. Em engines sem "apagar para todos" (ex.: Baileys), o bot só sai.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Comunidade removida/abandonada — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  remove(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.remove(id, jid);
  }

  @Put(':jid/subject')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Altera o nome da comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Nome alterado — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  subject(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: UpdateCommunitySubjectDto,
  ) {
    return this.svc.setSubject(id, jid, dto.subject);
  }

  @Put(':jid/description')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Altera a descrição da comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Descrição alterada — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  description(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: UpdateCommunityDescriptionDto,
  ) {
    return this.svc.setDescription(id, jid, dto.description);
  }

  @Put(':jid/image')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Altera a imagem de perfil da comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Imagem alterada — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  image(@Param('id') id: string, @Param('jid') jid: string, @Body() dto: UpdateCommunityImageDto) {
    return this.svc.setImage(id, jid, dto);
  }

  @Post(':jid/admins')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Promove/rebaixa admins da comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiCreatedResponse({
    description: 'Status por membro alvo.',
    schema: { type: 'array', items: GROUP_PARTICIPANT_RESULT_SCHEMA },
  })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  admins(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: UpdateCommunityAdminsDto,
  ) {
    return this.svc.updateAdmins(id, jid, dto.members, dto.action);
  }

  @Get(':jid/members')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista os participantes agregados da comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: { type: 'array', items: COMMUNITY_PARTICIPANT_SCHEMA } })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  members(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.listMembers(id, jid);
  }

  @Get(':jid/members/count')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Conta os participantes agregados da comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({
    schema: { type: 'object', properties: { count: { type: 'number' } } },
  })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  countMembers(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.countMembers(id, jid);
  }

  @Get(':jid/invite')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Código e link de convite da comunidade.' })
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
  revokeInvite(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.revokeInvite(id, jid);
  }

  @Post(':jid/invite/probe')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary:
      'Sonda se o convite é acessível, sem expor o código (útil para detecção de banimento).',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        reachable: { type: 'boolean', description: 'true = convite acessível' },
      },
    },
  })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  probeInvite(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.probeInvite(id, jid);
  }

  @Get(':jid/groups')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista os subgrupos vinculados à comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: { type: 'array', items: COMMUNITY_LINKED_GROUP_SCHEMA } })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  linkedGroups(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.listLinkedGroups(id, jid);
  }

  @Post(':jid/groups')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Vincula um grupo existente como subgrupo da comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiCreatedResponse({ description: 'Grupo vinculado — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  linkGroup(@Param('id') id: string, @Param('jid') jid: string, @Body() dto: LinkGroupDto) {
    return this.svc.linkGroup(id, jid, dto.groupJid);
  }

  @Delete(':jid/groups/:groupJid')
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({ summary: 'Desvincula um subgrupo da comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiParam({
    name: 'groupJid',
    description: 'jid do subgrupo (…@g.us) a desvincular da comunidade.',
  })
  @ApiOkResponse({ description: 'Subgrupo desvinculado — resposta sem corpo.' })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  unlinkGroup(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Param('groupJid') groupJid: string,
  ) {
    return this.svc.unlinkGroup(id, jid, groupJid);
  }

  @Post(':jid/announcement')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Publica no grupo de anúncios da comunidade (com fanout opcional para outras).',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiCreatedResponse({
    description: 'Um SendResult por comunidade alvo (a própria + as de fanout).',
    schema: { type: 'array', items: SEND_RESULT_SCHEMA },
  })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  announcement(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: SendCommunityAnnouncementDto,
  ) {
    return this.svc.sendAnnouncement(id, jid, dto);
  }

  @Post(':jid/sync')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Resincroniza metadados + participantes de UMA comunidade.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Comunidade resincronizada.', schema: COMMUNITY_INFO_SCHEMA })
  @ApiResponse({ status: 501, description: NOT_SUPPORTED })
  syncOne(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.syncOne(id, jid);
  }
}
