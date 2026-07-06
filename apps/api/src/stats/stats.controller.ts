import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { StatsService } from './stats.service';

@ApiTags('Stats')
@ApiSecurity('apikey')
@Controller('stats')
@UseGuards(GlobalApiKeyGuard)
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get('overview')
  @ApiOperation({
    summary: 'Métricas agregadas: mensagens (funil de ack, série diária) e webhooks.',
  })
  overview() {
    return this.stats.overview();
  }
}
