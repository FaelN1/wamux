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
import { ApiKeyAction, MessageAckStatus, MessageType } from '@wamux/shared';
import { ID_PARAM, JID_PARAM } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { InboxQueryService } from './inbox-query.service';
import { ListChatsQueryDto } from './dto/list-chats.query.dto';
import { ListChatMessagesQueryDto } from './dto/list-chat-messages.query.dto';
import { ListContactsQueryDto } from './dto/list-contacts.query.dto';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

const CHAT_TYPES = ['user', 'group', 'newsletter', 'broadcast'];

/** Item da lista de conversas (ChatSummary). */
const CHAT_SUMMARY_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jid: { type: 'string', description: 'usuário, grupo (@g.us) ou canal (@newsletter)' },
    type: { type: 'string', enum: CHAT_TYPES },
    name: {
      type: 'string',
      description: 'nome resolvido (name → verifiedName → pushName → jid)',
    },
    pushName: { type: 'string' },
    avatarUrl: { type: 'string' },
    lastMessageId: { type: 'string' },
    lastMessageText: { type: 'string' },
    lastMessageType: { type: 'string', enum: Object.values(MessageType) },
    lastMessageFromMe: { type: 'boolean' },
    lastMessageAck: { type: 'string', enum: Object.values(MessageAckStatus) },
    lastMessageAt: { type: 'number', description: 'unix (s) — cursor de ordenação "Newest first"' },
    unreadCount: { type: 'number' },
    archived: { type: 'boolean' },
    pinned: { type: 'boolean' },
  },
};

/** Contato persistido (ContactSummary). */
const CONTACT_SUMMARY_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jid: { type: 'string' },
    pushName: { type: 'string', description: 'nunca vazio (cai para verifiedName/número)' },
    name: { type: 'string' },
    verifiedName: { type: 'string' },
    isBusiness: { type: 'boolean' },
    avatarUrl: { type: 'string' },
  },
};

/** Item da thread persistida (ChatMessage). */
const CHAT_MESSAGE_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    chatId: { type: 'string' },
    fromMe: { type: 'boolean' },
    type: { type: 'string', enum: Object.values(MessageType) },
    text: { type: 'string' },
    pushName: { type: 'string' },
    senderId: { type: 'string', description: 'jid de quem enviou (grupos; ausente em outbound)' },
    senderAvatarUrl: { type: 'string', description: 'foto do remetente (só grupos)' },
    mediaUrl: { type: 'string' },
    mediaMimetype: { type: 'string' },
    mediaFilename: { type: 'string' },
    mediaCaption: { type: 'string' },
    quotedId: { type: 'string', description: 'id da mensagem citada (reply)' },
    reaction: { type: 'string', description: 'emoji agregado, quando disponível' },
    ack: { type: 'string', enum: Object.values(MessageAckStatus) },
    timestamp: { type: 'number', description: 'unix (s)' },
  },
};

/** Envelope de página cursor-based (PaginatedResult<T>). */
function paginated(item: SchemaObject): SchemaObject {
  return {
    type: 'object',
    properties: {
      items: { type: 'array', items: item },
      nextCursor: {
        type: 'string',
        description: 'cursor opaco da próxima página; ausente = fim',
      },
    },
  };
}

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
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lista de conversas persistidas',
    description:
      'Lista de conversas ("Conversations") do Inbox persistido, ordenada por atividade (newest first) e paginada por cursor.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    description: 'Página de conversas.',
    schema: paginated(CHAT_SUMMARY_SCHEMA),
  })
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
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Thread persistida de um chat',
    description:
      'Mensagens persistidas de um chat, paginadas por cursor (timestamp). Convive com a rota ao vivo (`GET chats/:jid/messages`).',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'qtd. de mensagens (1..100; padrão 50)',
  })
  @ApiQuery({
    name: 'before',
    required: false,
    description: 'unix (s) — cursor pra mensagens mais antigas',
  })
  @ApiOkResponse({
    description: 'Página de mensagens da thread.',
    schema: paginated(CHAT_MESSAGE_SCHEMA),
  })
  listMessages(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Query() q: ListChatMessagesQueryDto,
  ) {
    return this.query.listMessages(id, jid, { limit: q.limit, before: q.before });
  }

  @Get('contacts')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lista de contatos persistidos',
    description: 'Contatos persistidos, paginados por cursor (jid).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    description: 'Página de contatos.',
    schema: paginated(CONTACT_SUMMARY_SCHEMA),
  })
  listContacts(@Param('id') id: string, @Query() q: ListContactsQueryDto) {
    return this.query.listContacts(id, { cursor: q.cursor, limit: q.limit, q: q.q });
  }

  @Get('contacts/:jid')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Um contato persistido',
    description: 'Nome/avatar/flag business de um contato. 404 se não estiver persistido.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Contato persistido.', schema: CONTACT_SUMMARY_SCHEMA })
  getContact(@Param('id') id: string, @Param('jid') jid: string) {
    return this.query.getContact(id, jid);
  }
}
