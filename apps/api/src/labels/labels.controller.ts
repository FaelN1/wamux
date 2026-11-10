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
import { ID_PARAM, JID_PARAM, OK_SCHEMA } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { LabelsService } from './labels.service';
import { UpsertLabelDto } from './dto/upsert-label.dto';
import { SetLabelAssociationDto } from './dto/set-label-association.dto';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

/** Etiqueta normalizada (Label). */
const LABEL_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    color: {
      type: 'object',
      properties: {
        index: { type: 'number', description: 'índice da paleta do WhatsApp (0..19)' },
        hex: { type: 'string', description: 'hex (#RRGGBB), quando a lib informa' },
      },
    },
    count: { type: 'number', description: 'itens etiquetados, quando a lib informa' },
    active: { type: 'boolean', description: 'false quando a etiqueta foi removida' },
  },
};

const LABEL_LIST_SCHEMA: SchemaObject = { type: 'array', items: LABEL_SCHEMA };

/** Param de rota `:labelId` (id da etiqueta). */
const LABEL_ID_PARAM = { name: 'labelId', description: 'ID da etiqueta.' } as const;

const NOT_IMPL_501 = {
  status: 501,
  description: 'A engine da instância não suporta etiquetas (requer WhatsApp Business).',
};

@ApiTags('Etiquetas')
@ApiSecurity('apikey')
@Controller('instances/:id')
@UseGuards(InstanceApiKeyGuard)
export class LabelsController {
  constructor(private readonly labels: LabelsService) {}

  @Get('labels')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lista as etiquetas da conta',
    description: 'Etiquetas do WhatsApp Business. Gated por capabilities.labels.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: LABEL_LIST_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  list(@Param('id') id: string) {
    return this.labels.list(id);
  }

  @Post('labels')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Cria ou edita uma etiqueta',
    description: 'Sem `id` = cria; com `id` = edita. Gated por capabilities.labels.',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ description: 'Etiqueta criada/editada.', schema: LABEL_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  upsert(@Param('id') id: string, @Body() dto: UpsertLabelDto) {
    return this.labels.upsert(id, { id: dto.id, name: dto.name, color: dto.color });
  }

  @Delete('labels/:labelId')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({ summary: 'Remove uma etiqueta', description: 'Gated por capabilities.labels.' })
  @ApiParam(ID_PARAM)
  @ApiParam(LABEL_ID_PARAM)
  @ApiOkResponse({ schema: OK_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  async remove(@Param('id') id: string, @Param('labelId') labelId: string) {
    await this.labels.remove(id, labelId);
    return { ok: true };
  }

  @Put('labels/:labelId/associations')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Associa/desassocia a etiqueta',
    description: 'Liga/desliga a etiqueta em um chat ou contato. Gated por capabilities.labels.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(LABEL_ID_PARAM)
  @ApiOkResponse({ schema: OK_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
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
  @ApiOperation({
    summary: 'Chats de uma etiqueta',
    description: 'jids dos chats etiquetados. Gated por capabilities.labels.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(LABEL_ID_PARAM)
  @ApiOkResponse({
    description: 'jids dos chats etiquetados.',
    schema: { type: 'array', items: { type: 'string' } },
  })
  @ApiResponse(NOT_IMPL_501)
  chats(@Param('id') id: string, @Param('labelId') labelId: string) {
    return this.labels.chatsForLabel(id, labelId);
  }

  @Get('contacts/:jid/labels')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Etiquetas de um contato',
    description: 'Gated por capabilities.labels.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: LABEL_LIST_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  contactLabels(@Param('id') id: string, @Param('jid') jid: string) {
    return this.labels.labelsForTarget(id, { type: 'contact', id: jid });
  }

  @Get('chats/:jid/labels')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Etiquetas de um chat', description: 'Gated por capabilities.labels.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: LABEL_LIST_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  chatLabels(@Param('id') id: string, @Param('jid') jid: string) {
    return this.labels.labelsForTarget(id, { type: 'chat', id: jid });
  }
}
