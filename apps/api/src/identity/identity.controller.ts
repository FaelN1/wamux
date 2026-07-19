import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { IdentityService } from './identity.service';

@ApiTags('Identidade')
@ApiSecurity('apikey')
@Controller('instances')
@UseGuards(InstanceApiKeyGuard)
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}

  @Get(':id/identity/resolve')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Resolve a identidade canônica (lid ↔ pnJid ↔ phone).' })
  resolve(@Param('id') id: string, @Query('lid') lid?: string, @Query('phone') phone?: string) {
    return this.identity.resolve(id, { lid, phone });
  }
}
