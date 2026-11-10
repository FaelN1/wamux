import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction, MessageType } from '@wamux/shared';
import { ID_PARAM, JID_PARAM, OK_SCHEMA } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { ContactsService } from './contacts.service';
import { NumberCheckService } from './number-check.service';
import { SetPresenceDto } from './dto/set-presence.dto';
import { CheckNumbersDto } from './dto/check-numbers.dto';
import { FetchMessagesQueryDto } from './dto/fetch-messages.query.dto';
import { InboxQueryService } from '../inbox/inbox-query.service';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

/** Presença observada de um contato (PresenceInfo). */
const PRESENCE_INFO_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    chatId: { type: 'string' },
    lastKnownPresence: {
      type: 'string',
      enum: ['available', 'unavailable', 'composing', 'recording', 'paused'],
      description: 'último estado conhecido, quando a engine informa',
    },
    lastSeen: { type: 'number', description: 'epoch (s) do "visto por último", quando disponível' },
  },
};

/** Mensagem normalizada (modelo canônico), item da página ao vivo. */
const NORMALIZED_MESSAGE_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    provider: { type: 'string' },
    instanceId: { type: 'string' },
    id: { type: 'string' },
    chatId: { type: 'string' },
    from: { type: 'string' },
    fromMe: { type: 'boolean' },
    pushName: { type: 'string' },
    isGroup: { type: 'boolean' },
    chatType: { type: 'string', enum: ['user', 'group', 'newsletter', 'broadcast'] },
    timestamp: { type: 'number', description: 'unix (s)' },
    type: { type: 'string', enum: Object.values(MessageType) },
    text: { type: 'string' },
    media: {
      type: 'object',
      description: 'mídia normalizada (url/mimetype/caption…), quando houver',
    },
    location: { type: 'object', description: '{ latitude, longitude, name?, address? }' },
    raw: { description: 'payload cru do provider (depuração/campos não mapeados)' },
  },
};

/** Página ao vivo de mensagens (FetchMessagesPage). */
const FETCH_MESSAGES_PAGE_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    messages: { type: 'array', items: NORMALIZED_MESSAGE_SCHEMA },
    nextCursor: { type: 'string', description: 'cursor da próxima página; ausente = fim' },
  },
};

/** Resultado da checagem de um número (NumberCheckResult). */
const NUMBER_CHECK_RESULT_SCHEMA: SchemaObject = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      input: { type: 'string', description: 'entrada crua enviada' },
      exists: { type: 'boolean' },
      jid: { type: 'string', description: 'jid resolvido, quando existe' },
    },
  },
};

const NOT_IMPL_501 = {
  status: 501,
  description: 'A engine da instância não suporta esta operação.',
};

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
  @ApiOperation({ summary: 'Bloqueia um contato', description: 'Gated por capabilities.block.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: OK_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  async block(@Param('id') id: string, @Param('jid') jid: string) {
    await this.contacts.block(id, jid);
    return { ok: true };
  }

  @Post('contacts/:jid/unblock')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Desbloqueia um contato', description: 'Gated por capabilities.block.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: OK_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  async unblock(@Param('id') id: string, @Param('jid') jid: string) {
    await this.contacts.unblock(id, jid);
    return { ok: true };
  }

  @Post('presence')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Emite presença',
    description: 'Seta presença (digitando/gravando/online). Gated por capabilities.presence.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: OK_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
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
  @ApiOperation({
    summary: 'Consulta a presença de um contato',
    description: 'Gated por capabilities.presence.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: PRESENCE_INFO_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  getPresence(@Param('id') id: string, @Param('jid') jid: string) {
    return this.contacts.getPresence(id, jid);
  }

  @Get('chats/:jid/messages')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Mensagens ao vivo de um chat',
    description:
      'Busca mensagens direto na engine, paginadas por cursor. Gated por capabilities.fetchMessages.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'qtd. de mensagens (1..100; padrão 50)',
  })
  @ApiQuery({ name: 'before', required: false, description: 'cursor opaco (id) da engine' })
  @ApiOkResponse({ schema: FETCH_MESSAGES_PAGE_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  messages(@Param('id') id: string, @Param('jid') jid: string, @Query() q: FetchMessagesQueryDto) {
    return this.contacts.fetchMessages(id, jid, q.limit ?? 50, q.before);
  }

  @Post('numbers/check')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Checa se números têm WhatsApp',
    description:
      'Teto de 20 por lote + cache + rate-limit (anti-ban). Gated por capabilities.checkNumbers.',
  })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({
    description: 'Resultado por número (mesma ordem/deduplicado).',
    schema: NUMBER_CHECK_RESULT_SCHEMA,
  })
  @ApiResponse(NOT_IMPL_501)
  check(@Param('id') id: string, @Body() dto: CheckNumbersDto) {
    return this.numbers.check(id, dto.numbers);
  }

  @Post('chats/:jid/read')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Marca um chat como lido',
    description:
      'Zera o unread persistido do Inbox e emite o markRead ao vivo (protocolo). Gated por capabilities.markRead.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: OK_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
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
