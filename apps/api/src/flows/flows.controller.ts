import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { FlowsService } from './flows.service';
import { CreateFlowDto } from './dto/create-flow.dto';
import { UpdateFlowJsonDto } from './dto/update-flow-json.dto';
import { SendFlowDto } from './dto/send-flow.dto';
import { FlowMetricsQueryDto } from './dto/flow-metrics.query.dto';

@ApiTags('Flows (Cloud)')
@ApiSecurity('apikey')
@Controller('instances/:id/flows')
@UseGuards(InstanceApiKeyGuard)
export class FlowsController {
  constructor(private readonly svc: FlowsService) {}

  // ── rota estática antes das param ──

  @Post('send')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia um Flow (interactive flow).' })
  send(@Param('id') id: string, @Body() dto: SendFlowDto) {
    return this.svc.send(id, dto);
  }

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista os Flows da WABA.' })
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post()
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Cria um Flow (opcionalmente já com flow_json e publish).' })
  create(@Param('id') id: string, @Body() dto: CreateFlowDto) {
    return this.svc.create(id, dto);
  }

  @Get(':flowId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Detalhe de um Flow (com validation_errors/preview).' })
  get(@Param('id') id: string, @Param('flowId') flowId: string) {
    return this.svc.get(id, flowId);
  }

  @Post(':flowId/assets')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Atualiza o flow.json (só DRAFT). Devolve validation_errors.' })
  updateJson(
    @Param('id') id: string,
    @Param('flowId') flowId: string,
    @Body() dto: UpdateFlowJsonDto,
  ) {
    return this.svc.updateJson(id, flowId, dto.flowJson);
  }

  @Post(':flowId/publish')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Publica o Flow (torna-se imutável).' })
  async publish(@Param('id') id: string, @Param('flowId') flowId: string) {
    await this.svc.publish(id, flowId);
    return { ok: true };
  }

  @Post(':flowId/deprecate')
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Deprecia um Flow publicado.' })
  async deprecate(@Param('id') id: string, @Param('flowId') flowId: string) {
    await this.svc.deprecate(id, flowId);
    return { ok: true };
  }

  @Get(':flowId/metrics')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Métricas de um Flow.' })
  metrics(
    @Param('id') id: string,
    @Param('flowId') flowId: string,
    @Query() q: FlowMetricsQueryDto,
  ) {
    return this.svc.metrics(id, flowId, q);
  }

  @Delete(':flowId')
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({ summary: 'Apaga um Flow (só DRAFT).' })
  async remove(@Param('id') id: string, @Param('flowId') flowId: string) {
    await this.svc.remove(id, flowId);
    return { ok: true };
  }
}
