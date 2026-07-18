import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { InboxQueryService } from './inbox-query.service';
import { ListChatsQueryDto } from './dto/list-chats.query.dto';
import { ListChatMessagesQueryDto } from './dto/list-chat-messages.query.dto';
import { ListContactsQueryDto } from './dto/list-contacts.query.dto';

/**
 * Leitura persistida do Inbox — sempre do DB (`ContactEntity`/
 * `MessageLogEntity`), nunca do engine ao vivo. Vazio/degradado quando as
 * flags de `persistence` estão off (design opt-in) — ver
 * `docs/inbox-persistencia-handoff.md` §6.
 */
@ApiTags('Inbox')
@ApiSecurity('apikey')
@Controller('instances/:id')
@UseGuards(InstanceApiKeyGuard)
export class InboxController {
  constructor(private readonly query: InboxQueryService) {}

  @Get('chats')
  @ApiOperation({ summary: 'Lista de conversas persistidas ("Conversations"), Newest first.' })
  listChats(@Param('id') id: string, @Query() q: ListChatsQueryDto) {
    return this.query.listChats(id, {
      cursor: q.cursor,
      limit: q.limit,
      archived: q.archived != null ? q.archived === 'true' : undefined,
      type: q.type,
      q: q.q,
    });
  }

  @Get('chats/:jid/messages/db')
  @ApiOperation({
    summary: 'Thread persistida de um chat (paginada por cursor). Convive com a rota ao vivo.',
  })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({
    name: 'before',
    required: false,
    description: 'unix (s) — cursor pra mensagens mais antigas',
  })
  listMessages(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Query() q: ListChatMessagesQueryDto,
  ) {
    return this.query.listMessages(id, jid, { limit: q.limit, before: q.before });
  }

  @Get('contacts')
  @ApiOperation({ summary: 'Lista de contatos persistidos, paginada por cursor.' })
  listContacts(@Param('id') id: string, @Query() q: ListContactsQueryDto) {
    return this.query.listContacts(id, { cursor: q.cursor, limit: q.limit, q: q.q });
  }

  @Get('contacts/:jid')
  @ApiOperation({ summary: 'Um contato persistido (nome/avatar/business).' })
  getContact(@Param('id') id: string, @Param('jid') jid: string) {
    return this.query.getContact(id, jid);
  }
}
