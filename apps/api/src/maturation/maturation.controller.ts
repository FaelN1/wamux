import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { MaturationPlanDTO } from '@wamux/shared';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { MaturationService } from './maturation.service';
import { CreateMaturationPlanDto } from './dto/create-maturation-plan.dto';
import { UpdateMaturationPlanDto } from './dto/update-maturation-plan.dto';

/**
 * Painel de maturação — escopo ADMIN (GLOBAL_API_KEY): um plano atravessa
 * várias instâncias, então não faz sentido a key de uma instância só.
 */
@ApiTags('Maturation')
@ApiSecurity('apikey')
@Controller('maturation/plans')
@UseGuards(GlobalApiKeyGuard)
export class MaturationController {
  constructor(private readonly service: MaturationService) {}

  @Get()
  @ApiOperation({ summary: 'Lista os planos de maturação com progresso computado.' })
  list(): Promise<MaturationPlanDTO[]> {
    return this.service.list();
  }

  @Post()
  @ApiOperation({ summary: 'Cria um plano (draft) — valida config e elegibilidade dos números.' })
  create(@Body() dto: CreateMaturationPlanDto): Promise<MaturationPlanDTO> {
    return this.service.create(dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Um plano com progresso por número + feed de eventos.' })
  get(@Param('id', ParseUUIDPipe) id: string): Promise<MaturationPlanDTO> {
    return this.service.get(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Edita um plano (somente pausado/draft/concluído).' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateMaturationPlanDto,
  ): Promise<MaturationPlanDTO> {
    return this.service.update(id, dto);
  }

  @Post(':id/start')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia, retoma (pausado) ou reinicia a rampa (concluído).' })
  start(@Param('id', ParseUUIDPipe) id: string): Promise<MaturationPlanDTO> {
    return this.service.start(id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @ApiOperation({ summary: 'Pausa o plano — o dia da rampa congela até retomar.' })
  pause(@Param('id', ParseUUIDPipe) id: string): Promise<MaturationPlanDTO> {
    return this.service.pause(id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove o plano e cancela os turnos agendados.' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.remove(id);
  }
}
