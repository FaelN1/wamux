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
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { CommunitiesService } from './communities.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { UpdateCommunitySubjectDto } from './dto/update-community-subject.dto';
import { UpdateCommunityDescriptionDto } from './dto/update-community-description.dto';
import { UpdateCommunityImageDto } from './dto/update-community-image.dto';
import { UpdateCommunityAdminsDto } from './dto/update-community-admins.dto';
import { LinkGroupDto } from './dto/link-group.dto';
import { SendCommunityAnnouncementDto } from './dto/send-community-announcement.dto';

@ApiTags('Comunidades')
@ApiSecurity('apikey')
@Controller('instances/:id/communities')
@UseGuards(InstanceApiKeyGuard)
export class CommunitiesController {
  constructor(private readonly svc: CommunitiesService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as comunidades de que a conta participa.' })
  @ApiQuery({
    name: 'onlyOwnedOrAdmin',
    required: false,
    type: Boolean,
    description:
      'Quando "true", filtra pra só as comunidades onde a própria conta é admin ou superadmin ' +
      '(exclui as em que é só membro comum). Sem o param, traz tudo (comportamento atual).',
  })
  list(@Param('id') id: string, @Query('onlyOwnedOrAdmin') onlyOwnedOrAdmin?: string) {
    return this.svc.list(id, onlyOwnedOrAdmin === 'true');
  }

  @Post()
  @ApiOperation({ summary: 'Cria uma comunidade (grupo-pai).' })
  create(@Param('id') id: string, @Body() dto: CreateCommunityDto) {
    return this.svc.create(id, dto);
  }

  // Rota estática antes de :jid para não colidir com o param.
  @Post('sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resincroniza todas as comunidades (metadados + participantes).' })
  @ApiQuery({
    name: 'onlyOwnedOrAdmin',
    required: false,
    type: Boolean,
    description:
      'Mesmo filtro de GET / — só retorna as comunidades onde a conta é admin/superadmin.',
  })
  syncAll(@Param('id') id: string, @Query('onlyOwnedOrAdmin') onlyOwnedOrAdmin?: string) {
    return this.svc.syncAll(id, onlyOwnedOrAdmin === 'true');
  }

  @Get(':jid')
  @ApiOperation({ summary: 'Metadados da comunidade (participantes, grupo de anúncios, etc.).' })
  metadata(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.metadata(id, jid);
  }

  @Delete(':jid')
  @ApiOperation({
    summary:
      'Remove a comunidade. Em engines sem "apagar para todos" (ex.: Baileys), o bot só sai.',
  })
  remove(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.remove(id, jid);
  }

  @Put(':jid/subject')
  @ApiOperation({ summary: 'Altera o nome da comunidade.' })
  subject(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: UpdateCommunitySubjectDto,
  ) {
    return this.svc.setSubject(id, jid, dto.subject);
  }

  @Put(':jid/description')
  @ApiOperation({ summary: 'Altera a descrição da comunidade.' })
  description(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: UpdateCommunityDescriptionDto,
  ) {
    return this.svc.setDescription(id, jid, dto.description);
  }

  @Put(':jid/image')
  @ApiOperation({ summary: 'Altera a imagem de perfil da comunidade.' })
  image(@Param('id') id: string, @Param('jid') jid: string, @Body() dto: UpdateCommunityImageDto) {
    return this.svc.setImage(id, jid, dto);
  }

  @Post(':jid/admins')
  @ApiOperation({ summary: 'Promove/rebaixa admins da comunidade.' })
  admins(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: UpdateCommunityAdminsDto,
  ) {
    return this.svc.updateAdmins(id, jid, dto.members, dto.action);
  }

  @Get(':jid/members')
  @ApiOperation({ summary: 'Lista os participantes agregados da comunidade.' })
  members(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.listMembers(id, jid);
  }

  @Get(':jid/members/count')
  @ApiOperation({ summary: 'Conta os participantes agregados da comunidade.' })
  countMembers(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.countMembers(id, jid);
  }

  @Get(':jid/invite')
  @ApiOperation({ summary: 'Código e link de convite da comunidade.' })
  invite(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.getInvite(id, jid);
  }

  @Delete(':jid/invite')
  @ApiOperation({ summary: 'Revoga o convite atual e gera um novo.' })
  revokeInvite(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.revokeInvite(id, jid);
  }

  @Post(':jid/invite/probe')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Sonda se o convite é acessível, sem expor o código (útil para detecção de banimento).',
  })
  probeInvite(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.probeInvite(id, jid);
  }

  @Get(':jid/groups')
  @ApiOperation({ summary: 'Lista os subgrupos vinculados à comunidade.' })
  linkedGroups(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.listLinkedGroups(id, jid);
  }

  @Post(':jid/groups')
  @ApiOperation({ summary: 'Vincula um grupo existente como subgrupo da comunidade.' })
  linkGroup(@Param('id') id: string, @Param('jid') jid: string, @Body() dto: LinkGroupDto) {
    return this.svc.linkGroup(id, jid, dto.groupJid);
  }

  @Delete(':jid/groups/:groupJid')
  @ApiOperation({ summary: 'Desvincula um subgrupo da comunidade.' })
  unlinkGroup(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Param('groupJid') groupJid: string,
  ) {
    return this.svc.unlinkGroup(id, jid, groupJid);
  }

  @Post(':jid/announcement')
  @ApiOperation({
    summary: 'Publica no grupo de anúncios da comunidade (com fanout opcional para outras).',
  })
  announcement(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: SendCommunityAnnouncementDto,
  ) {
    return this.svc.sendAnnouncement(id, jid, dto);
  }

  @Post(':jid/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Resincroniza metadados + participantes de UMA comunidade.' })
  syncOne(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.syncOne(id, jid);
  }
}
