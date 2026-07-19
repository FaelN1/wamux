import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { ContactsService } from './contacts.service';
import { NumberCheckService } from './number-check.service';
import { SetPresenceDto } from './dto/set-presence.dto';
import { CheckNumbersDto } from './dto/check-numbers.dto';
import { FetchMessagesQueryDto } from './dto/fetch-messages.query.dto';
import { InboxQueryService } from '../inbox/inbox-query.service';

@ApiTags('Contatos & Chats')
@ApiSecurity('apikey')
@Controller('instances/:id')
@UseGuards(InstanceApiKeyGuard)
export class ContactsController {
  constructor(
    private readonly contacts: ContactsService,
    private readonly numbers: NumberCheckService,
    private readonly inboxQuery: InboxQueryService,
  ) {}

  @Post('contacts/:jid/block')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Bloqueia um contato.' })
  async block(@Param('id') id: string, @Param('jid') jid: string) {
    await this.contacts.block(id, jid);
    return { ok: true };
  }

  @Post('contacts/:jid/unblock')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Desbloqueia um contato.' })
  async unblock(@Param('id') id: string, @Param('jid') jid: string) {
    await this.contacts.unblock(id, jid);
    return { ok: true };
  }

  @Post('presence')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Seta presença (digitando/gravando/online).' })
  async setPresence(@Param('id') id: string, @Body() dto: SetPresenceDto) {
    await this.contacts.setPresence(id, {
      to: dto.to,
      state: dto.state,
      durationMs: dto.durationMs,
    });
    return { ok: true };
  }

  @Get('contacts/:jid/presence')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Consulta a presença de um contato.' })
  getPresence(@Param('id') id: string, @Param('jid') jid: string) {
    return this.contacts.getPresence(id, jid);
  }

  @Get('chats/:jid/messages')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Mensagens de um chat, paginadas por cursor.' })
  messages(@Param('id') id: string, @Param('jid') jid: string, @Query() q: FetchMessagesQueryDto) {
    return this.contacts.fetchMessages(id, jid, q.limit ?? 50, q.before);
  }

  @Post('numbers/check')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Checa se números têm WhatsApp (teto 20 + cache + rate-limit).' })
  check(@Param('id') id: string, @Body() dto: CheckNumbersDto) {
    return this.numbers.check(id, dto.numbers);
  }

  @Post('chats/:jid/read')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Marca um chat como lido (protocolo ao vivo + unread persistido do Inbox).',
  })
  async read(@Param('id') id: string, @Param('jid') jid: string) {
    // Unread local primeiro — operação de DB pura, não depende de conexão
    // ao vivo. Se o markRead ao vivo (abaixo) falhar (ex.: desconectado), o
    // unread do Inbox já ficou zerado mesmo assim (comportamento existente
    // de propagar o erro do ao-vivo é preservado, só a ordem garante que a
    // parte persistida não fica refém da ao-vivo).
    await this.inboxQuery.markRead(id, jid);
    await this.contacts.markRead(id, jid);
    return { ok: true };
  }
}
