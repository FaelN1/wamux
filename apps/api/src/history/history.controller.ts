import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { StartImportDto } from './dto/import-history.dto';
import { HistoryService } from './history.service';

@ApiTags('Histórico')
@ApiSecurity('apikey')
@Controller('instances')
@UseGuards(InstanceApiKeyGuard)
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Post(':id/history/import')
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Dispara import de histórico por range de data (async).' })
  async start(@Param('id') id: string, @Body() dto: StartImportDto) {
    const job = await this.history.start(id, dto);
    return { jobId: job.id, status: job.status };
  }

  @Get(':id/history/import/:jobId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Progresso do import (%, contadores, estado).' })
  status(@Param('id') id: string, @Param('jobId') jobId: string) {
    return this.history.status(id, jobId);
  }

  @Post(':id/history/import/:jobId/cancel')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Cancela o import em andamento.' })
  async cancel(@Param('id') id: string, @Param('jobId') jobId: string) {
    await this.history.cancel(id, jobId);
    return { ok: true };
  }
}
