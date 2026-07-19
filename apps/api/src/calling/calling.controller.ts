import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { CallingService } from './calling.service';
import { ConnectCallDto, RequestPermissionDto } from './dto/calling.dto';

@ApiTags('Calling (Cloud)')
@ApiSecurity('apikey')
@Controller('instances/:id/calling')
@UseGuards(InstanceApiKeyGuard)
export class CallingController {
  constructor(private readonly svc: CallingService) {}

  @Post('settings')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Configura o calling do número (status, call_hours, callback).' })
  async configure(@Param('id') id: string, @Body() settings: Record<string, unknown>) {
    await this.svc.configure(id, settings);
    return { ok: true };
  }

  @Get('settings')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lê as configurações de calling do número.' })
  getSettings(@Param('id') id: string) {
    return this.svc.getSettings(id);
  }

  @Post('permission-request')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Pede permissão de chamada (janela 24h).' })
  requestPermission(@Param('id') id: string, @Body() dto: RequestPermissionDto) {
    return this.svc.requestPermission(id, dto.to, dto.text);
  }

  @Get('permission')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Consulta o status de permissão de chamada de um usuário.' })
  getPermission(@Param('id') id: string, @Query('waId') waId: string) {
    return this.svc.getPermission(id, waId);
  }

  @Post('action')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Ciclo da chamada: connect/pre_accept/accept/reject/terminate.' })
  action(@Param('id') id: string, @Body() dto: ConnectCallDto) {
    return this.svc.action(id, dto);
  }
}
