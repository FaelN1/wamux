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
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { LabelsService } from './labels.service';
import { UpsertLabelDto } from './dto/upsert-label.dto';
import { SetLabelAssociationDto } from './dto/set-label-association.dto';

@ApiTags('Etiquetas')
@ApiSecurity('apikey')
@Controller('instances/:id')
@UseGuards(InstanceApiKeyGuard)
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('labels')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista as etiquetas da conta (WhatsApp Business).' })
  list(@Param('id') id: string) {
    return this.labels.list(id);
  }

  @Post('labels')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Cria (sem id) ou edita (com id) uma etiqueta.' })
  upsert(@Param('id') id: string, @Body() dto: UpsertLabelDto) {
    return this.labels.upsert(id, { id: dto.id, name: dto.name, color: dto.color });
  }

  @Delete('labels/:labelId')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({ summary: 'Remove uma etiqueta.' })
  async remove(@Param('id') id: string, @Param('labelId') labelId: string) {
    await this.labels.remove(id, labelId);
    return { ok: true };
  }

  @Put('labels/:labelId/associations')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Associa/desassocia a etiqueta a um chat ou contato.' })
  async setAssociation(
    @Param('id') id: string,
    @Param('labelId') labelId: string,
    @Body() dto: SetLabelAssociationDto,
  ) {
    await this.labels.setAssociation(
      id,
      labelId,
      { type: dto.targetType, id: dto.targetId },
      dto.on,
    );
    return { ok: true };
  }

  @Get('labels/:labelId/chats')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista os chats etiquetados com esta etiqueta.' })
  chats(@Param('id') id: string, @Param('labelId') labelId: string) {
    return this.labels.chatsForLabel(id, labelId);
  }

  @Get('contacts/:jid/labels')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Etiquetas de um contato.' })
  contactLabels(@Param('id') id: string, @Param('jid') jid: string) {
    return this.labels.labelsForTarget(id, { type: 'contact', id: jid });
  }

  @Get('chats/:jid/labels')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Etiquetas de um chat.' })
  chatLabels(@Param('id') id: string, @Param('jid') jid: string) {
    return this.labels.labelsForTarget(id, { type: 'chat', id: jid });
  }
}
