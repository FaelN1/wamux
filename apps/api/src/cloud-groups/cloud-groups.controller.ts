import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { CloudGroupsService } from './cloud-groups.service';
import { CreateCloudGroupDto, RemoveParticipantDto } from './dto/cloud-group.dto';

@ApiTags('Grupos Cloud')
@ApiSecurity('apikey')
@Controller('instances/:id/cloud-groups')
@UseGuards(InstanceApiKeyGuard)
export class CloudGroupsController {
  constructor(private readonly svc: CloudGroupsService) {}

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista os grupos da Cloud API (OBA-gated, máx 8).' })
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post()
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Cria um grupo Cloud. (bodies a validar em conta real)' })
  create(@Param('id') id: string, @Body() dto: CreateCloudGroupDto) {
    return this.svc.create(id, dto);
  }

  @Get(':groupId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Detalhe de um grupo Cloud.' })
  get(@Param('id') id: string, @Param('groupId') groupId: string) {
    return this.svc.get(id, groupId);
  }

  @Get(':groupId/invite')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Link de convite do grupo.' })
  invite(@Param('id') id: string, @Param('groupId') groupId: string) {
    return this.svc.invite(id, groupId);
  }

  @Post(':groupId/invite')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Reseta o link de convite.' })
  resetInvite(@Param('id') id: string, @Param('groupId') groupId: string) {
    return this.svc.resetInvite(id, groupId);
  }

  @Post(':groupId/participants/remove')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Remove um participante do grupo.' })
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
  @ApiOperation({ summary: 'Apaga/sai do grupo Cloud.' })
  async remove(@Param('id') id: string, @Param('groupId') groupId: string) {
    await this.svc.remove(id, groupId);
    return { ok: true };
  }
}
