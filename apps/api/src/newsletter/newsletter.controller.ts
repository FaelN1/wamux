import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction, MessageAckStatus } from '@wamux/shared';
import { ID_PARAM, JID_PARAM } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { NewsletterService } from './newsletter.service';
import { CreateNewsletterDto } from './dto/create-newsletter.dto';
import { SendNewsletterMessageDto } from './dto/send-newsletter-message.dto';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

/** Canal (NewsletterInfo). */
const NEWSLETTER_INFO_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jid: { type: 'string', description: '<id>@newsletter' },
    name: { type: 'string' },
    description: { type: 'string' },
    subscriberCount: { type: 'number' },
    role: { type: 'string', enum: ['owner', 'admin', 'subscriber', 'guest'] },
    muted: { type: 'boolean' },
    inviteCode: { type: 'string', description: 'parte final de whatsapp.com/channel/<code>' },
    pictureUrl: { type: 'string' },
    verified: { type: 'boolean' },
  },
};

const NEWSLETTER_LIST_SCHEMA: SchemaObject = { type: 'array', items: NEWSLETTER_INFO_SCHEMA };

/** Resultado de envio (SendResult). */
const SEND_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    to: { type: 'string' },
    timestamp: { type: 'number' },
    status: { type: 'string', enum: ['sent', 'queued'] },
    ack: { type: 'string', enum: Object.values(MessageAckStatus), description: 'ack inicial' },
    fallbackUsed: {
      type: 'boolean',
      description: 'true quando o interativo degradou para texto',
    },
  },
};

const NOT_IMPL_501 = {
  status: 501,
  description: 'A engine da instância não suporta canais (newsletter).',
};

@ApiTags('Canais (Newsletter)')
@ApiSecurity('apikey')
@Controller('instances/:id/newsletters')
@UseGuards(InstanceApiKeyGuard)
export class NewsletterController {
  constructor(private readonly svc: NewsletterService) {}

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Lista os canais seguidos',
    description: 'Gated por capabilities.newsletter.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: NEWSLETTER_LIST_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post()
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Cria um canal', description: 'Gated por capabilities.newsletter.' })
  @ApiParam(ID_PARAM)
  @ApiCreatedResponse({ description: 'Canal criado.', schema: NEWSLETTER_INFO_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  create(@Param('id') id: string, @Body() dto: CreateNewsletterDto) {
    return this.svc.create(id, dto);
  }

  @Get(':jid')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Metadados de um canal',
    description: 'Gated por capabilities.newsletter.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ schema: NEWSLETTER_INFO_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  meta(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.metadata(id, jid);
  }

  @Post(':jid/follow')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Segue um canal', description: 'Gated por capabilities.newsletter.' })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Passou a seguir o canal (sem corpo).' })
  @ApiResponse(NOT_IMPL_501)
  follow(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.follow(id, jid);
  }

  @Delete(':jid/follow')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({
    summary: 'Deixa de seguir um canal',
    description: 'Gated por capabilities.newsletter.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiOkResponse({ description: 'Deixou de seguir o canal (sem corpo).' })
  @ApiResponse(NOT_IMPL_501)
  unfollow(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.unfollow(id, jid);
  }

  @Post(':jid/message')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Publica no canal',
    description:
      'Texto sempre; mídia só se capabilities.newsletterMedia; enquete só se capabilities.newsletterPoll. ' +
      '422 quando mídia/enquete não é suportada pela engine; 400 quando o corpo está vazio.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam(JID_PARAM)
  @ApiCreatedResponse({ description: 'Mensagem publicada.', schema: SEND_RESULT_SCHEMA })
  @ApiResponse(NOT_IMPL_501)
  @ApiResponse({
    status: 422,
    description: 'Mídia ou enquete não suportada em canal nesta engine.',
  })
  sendMessage(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: SendNewsletterMessageDto,
  ) {
    return this.svc.sendMessage(id, jid, dto);
  }
}
