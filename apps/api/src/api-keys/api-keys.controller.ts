import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { InstanceId } from '../common/instance-id.decorator';
import { KeyActions } from '../common/key-actions.decorator';
import { RequireScope } from '../common/require-scope.decorator';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto } from './dto/create-api-key.dto';

/**
 * Gestão de API keys escopadas da instância (§6 do design doc). Exige a
 * ação `app` — só quem já tem `app` pode criar/listar/revogar keys da
 * própria instância (key mestra e GLOBAL_API_KEY sempre têm `app`).
 */
@ApiTags('API Keys')
@ApiSecurity('apikey')
@Controller('instances/:id/api-keys')
@UseGuards(InstanceApiKeyGuard)
export class ApiKeysController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Post()
  @RequireScope(ApiKeyAction.APP)
  @ApiOperation({
    summary: 'Cria uma API key escopada — a key crua só aparece nesta resposta, uma vez.',
  })
  async create(
    @InstanceId() instanceId: string,
    @KeyActions() callerActions: ApiKeyAction[],
    @Body() dto: CreateApiKeyDto,
  ) {
    // anti-escalonamento (§8): não dá pra conceder uma ação que a própria key não tem.
    const notAllowed = dto.actions.filter((a) => !callerActions.includes(a));
    if (notAllowed.length > 0) {
      throw new ForbiddenException(
        `Sua key não tem "${notAllowed.join(', ')}" — não pode conceder isso a uma key nova.`,
      );
    }
    return this.apiKeys.create(instanceId, dto);
  }

  @Get()
  @RequireScope(ApiKeyAction.APP)
  @ApiOperation({ summary: 'Lista as API keys escopadas da instância (nunca a key crua).' })
  list(@InstanceId() instanceId: string) {
    return this.apiKeys.list(instanceId);
  }

  @Delete(':keyId')
  @RequireScope(ApiKeyAction.APP)
  @ApiOperation({ summary: 'Revoga uma API key escopada (soft — mantém o histórico).' })
  async revoke(@InstanceId() instanceId: string, @Param('keyId') keyId: string) {
    await this.apiKeys.revoke(instanceId, keyId);
    return { revoked: true };
  }
}
