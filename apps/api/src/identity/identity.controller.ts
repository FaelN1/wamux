import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction } from '@wamux/shared';
import { ID_PARAM } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { IdentityService } from './identity.service';

/** Identidade canônica resolvida (Identity). */
const IDENTITY_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    lid: { type: 'string', description: '<id>@lid — não expõe o número' },
    pnJid: { type: 'string', description: '<numero>@s.whatsapp.net (PN-JID clássico)' },
    phone: { type: 'string', description: 'número em dígitos (E.164 sem "+"), quando conhecido' },
    primary: {
      type: 'string',
      enum: ['lid', 'pn'],
      description: 'qual identificador ancora a dedup',
    },
  },
};

@ApiTags('Identidade')
@ApiSecurity('apikey')
@Controller('instances')
@UseGuards(InstanceApiKeyGuard)
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get(':id/identity/resolve')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Resolve a identidade canônica',
    description:
      'Unifica lid ↔ pnJid ↔ phone a partir do DB + cache. Devolve identidade parcial quando o par ainda não é conhecido (nunca falha por LID inesperado).',
  })
  @ApiParam(ID_PARAM)
  @ApiQuery({ name: 'lid', required: false, description: '<id>@lid (ou só o id numérico do lid)' })
  @ApiQuery({ name: 'phone', required: false, description: 'número em dígitos (E.164 sem "+")' })
  @ApiOkResponse({ schema: IDENTITY_SCHEMA })
  resolve(@Param('id') id: string, @Query('lid') lid?: string, @Query('phone') phone?: string) {
    return this.identity.resolve(id, { lid, phone });
  }
}
