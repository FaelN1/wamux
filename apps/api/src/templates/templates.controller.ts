import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { EditTemplateDto } from './dto/edit-template.dto';
import { SendTemplateDto } from './dto/send-template.dto';
import { ListTemplatesQueryDto } from './dto/list-templates.query.dto';
import { TemplateAnalyticsQueryDto } from './dto/template-analytics.query.dto';

@ApiTags('Templates (Cloud)')
@ApiSecurity('apikey')
@Controller('instances/:id/templates')
@UseGuards(InstanceApiKeyGuard)
export class TemplatesController {
  constructor(private readonly svc: TemplatesService) {}

  // ── rotas estáticas antes das param (evita capturar 'analytics'/'send') ──

  @Get('analytics')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Analytics de templates (sent/delivered/read/clicked).' })
  analytics(@Param('id') id: string, @Query() q: TemplateAnalyticsQueryDto) {
    return this.svc.analytics(id, {
      start: q.start,
      end: q.end,
      templateIds: q.templateIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      metricTypes: q.metricTypes
        ?.split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    });
  }

  @Post('send')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia um template (preenchendo os parâmetros).' })
  send(@Param('id') id: string, @Body() dto: SendTemplateDto) {
    return this.svc.send(id, dto);
  }

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista templates (filtros: category/status/language/name).' })
  list(@Param('id') id: string, @Query() q: ListTemplatesQueryDto) {
    return this.svc.list(id, q as never);
  }

  @Post()
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Cria um template (entra em review na Meta).' })
  create(@Param('id') id: string, @Body() dto: CreateTemplateDto) {
    return this.svc.create(id, dto);
  }

  @Delete()
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({ summary: 'Apaga um template por nome (todas as línguas) ou hsmId (1 locale).' })
  remove(@Param('id') id: string, @Query('name') name: string, @Query('hsmId') hsmId?: string) {
    return this.svc.remove(id, { name, hsmId });
  }

  @Get(':idOrName')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Detalhe de um template por id ou nome.' })
  get(@Param('id') id: string, @Param('idOrName') idOrName: string) {
    return this.svc.get(id, idOrName);
  }

  @Post(':templateId')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Edita category/components (só APPROVED/REJECTED).' })
  edit(
    @Param('id') id: string,
    @Param('templateId') templateId: string,
    @Body() dto: EditTemplateDto,
  ) {
    return this.svc.edit(id, templateId, dto);
  }
}
