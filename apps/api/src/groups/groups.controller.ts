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
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateParticipantsDto } from './dto/update-participants.dto';
import { UpdateSubjectDto } from './dto/update-subject.dto';
import { UpdateDescriptionDto } from './dto/update-description.dto';
import { GroupSettingDto } from './dto/group-setting.dto';
import { JoinGroupDto } from './dto/join-group.dto';

@ApiTags('Grupos')
@ApiSecurity('apikey')
@Controller('instances/:id/groups')
@UseGuards(InstanceApiKeyGuard)
export class GroupsController {
  constructor(private readonly svc: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os grupos de que a conta participa.' })
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post()
  @ApiOperation({ summary: 'Cria um grupo com participantes iniciais.' })
  create(@Param('id') id: string, @Body() dto: CreateGroupDto) {
    return this.svc.create(id, dto);
  }

  // Rota estática antes de :jid para não colidir com o param.
  @Post('join')
  @HttpCode(200)
  @ApiOperation({ summary: 'Entra num grupo por código ou link de convite.' })
  join(@Param('id') id: string, @Body() dto: JoinGroupDto) {
    return this.svc.join(id, dto.code);
  }

  @Get(':jid')
  @ApiOperation({ summary: 'Metadados do grupo (participantes, admins, settings).' })
  metadata(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.metadata(id, jid);
  }

  @Post(':jid/participants')
  @ApiOperation({ summary: 'Adiciona / remove / promove / rebaixa participantes.' })
  participants(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: UpdateParticipantsDto,
  ) {
    return this.svc.updateParticipants(id, jid, dto.participants, dto.action);
  }

  @Put(':jid/subject')
  @ApiOperation({ summary: 'Altera o assunto (nome) do grupo.' })
  subject(@Param('id') id: string, @Param('jid') jid: string, @Body() dto: UpdateSubjectDto) {
    return this.svc.setSubject(id, jid, dto.subject);
  }

  @Put(':jid/description')
  @ApiOperation({ summary: 'Altera a descrição do grupo.' })
  description(@Param('id') id: string, @Param('jid') jid: string, @Body() dto: UpdateDescriptionDto) {
    return this.svc.setDescription(id, jid, dto.description);
  }

  @Put(':jid/setting')
  @ApiOperation({ summary: 'Ajusta quem envia (announce) e quem edita infos (locked).' })
  setting(@Param('id') id: string, @Param('jid') jid: string, @Body() dto: GroupSettingDto) {
    return this.svc.setSetting(id, jid, dto.setting);
  }

  @Get(':jid/invite')
  @ApiOperation({ summary: 'Código e link de convite do grupo.' })
  invite(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.getInvite(id, jid);
  }

  @Delete(':jid/invite')
  @ApiOperation({ summary: 'Revoga o convite atual e gera um novo.' })
  revoke(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.revokeInvite(id, jid);
  }

  @Post(':jid/leave')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sai do grupo.' })
  leave(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.leave(id, jid);
  }
}
