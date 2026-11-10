import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction, MessageAckStatus } from '@wamux/shared';
import { ID_PARAM } from '../common/openapi';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { SendMediaDto } from './dto/send-media.dto';
import { SendTextDto } from './dto/send-text.dto';
import { SendPollDto } from './dto/send-poll.dto';
import { SendButtonsDto } from './dto/send-buttons.dto';
import { SendListDto } from './dto/send-list.dto';
import { SendPixDto } from './dto/send-pix.dto';
import { ReactMessageDto } from './dto/react-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { SendLocationDto } from './dto/send-location.dto';
import { SendContactDto } from './dto/send-contact.dto';
import { SendStatusDto } from './dto/send-status.dto';
import { RequestLocationDto } from './dto/request-location.dto';
import { MessagingService } from './messaging.service';

// ── Schemas reutilizáveis de resposta (documentam "o que retorna") ──

/**
 * Resultado dos envios que passam pela fachada de envio (rate-limit +
 * idempotência): imediato (status=sent), enfileirado (status=queued, com jobId)
 * ou duplicado por clientMessageId (duplicate=true).
 */
const SEND_OUTCOME_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'id da mensagem no WhatsApp (quando enviada na hora)' },
    to: { type: 'string', description: 'destino já normalizado pela engine' },
    timestamp: { type: 'number', description: 'epoch (segundos) do envio' },
    status: { type: 'string', enum: ['sent', 'queued', 'in_progress'] },
    queued: { type: 'boolean', description: 'true quando caiu na fila (estouro do rate-limit)' },
    duplicate: { type: 'boolean', description: 'true quando deduplicado por clientMessageId' },
    jobId: { type: 'string', description: 'id do job na fila (só quando status=queued)' },
  },
};

/** Resultado direto do provider (ações sobre mensagens e broadcast, fora da fila). */
const SEND_RESULT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string', description: 'id da mensagem resultante' },
    to: { type: 'string', description: 'destino já normalizado pela engine' },
    timestamp: { type: 'number', description: 'epoch (segundos)' },
    status: { type: 'string', enum: ['sent', 'queued'] },
    ack: {
      type: 'string',
      enum: Object.values(MessageAckStatus),
      description: 'ack inicial (a entrega real é confirmada por evento)',
    },
    fallbackUsed: {
      type: 'boolean',
      description: 'true quando o interativo degradou para texto (fallbackToText)',
    },
  },
};

/** Agregação de votos de uma enquete. */
const POLL_RESULTS_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    pollId: { type: 'string' },
    question: { type: 'string' },
    options: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          votes: { type: 'number' },
          voters: {
            type: 'array',
            items: { type: 'string' },
            description: 'jids/lids de quem votou nesta opção',
          },
        },
      },
    },
    totalVoters: { type: 'number' },
  },
};

/** Ack atual + histórico de timestamps de uma mensagem. */
const MESSAGE_STATUS_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    messageId: { type: 'string' },
    chatId: { type: 'string' },
    ack: { type: 'string', enum: Object.values(MessageAckStatus) },
    history: {
      type: 'object',
      description: 'ISO de cada transição de ack; null enquanto não ocorreu',
      properties: {
        serverAckAt: { type: 'string', format: 'date-time', nullable: true },
        deliveredAt: { type: 'string', format: 'date-time', nullable: true },
        readAt: { type: 'string', format: 'date-time', nullable: true },
        failedAt: { type: 'string', format: 'date-time', nullable: true },
      },
    },
    failureReason: { type: 'string', nullable: true },
  },
};

/** Estado de um envio que caiu na fila (throttle). */
const QUEUE_STATUS_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jobId: { type: 'string' },
    state: {
      type: 'string',
      description: 'estado do job (waiting/active/completed/failed/delayed/…)',
    },
    attemptsMade: { type: 'number' },
    returnValue: {
      type: 'object',
      nullable: true,
      description: 'retorno do job quando concluído (SendResult)',
    },
    failedReason: { type: 'string', nullable: true },
  },
};

@ApiTags('Mensagens')
@ApiSecurity('apikey')
@Controller('messages')
@UseGuards(InstanceApiKeyGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post(':id/text')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia texto',
    description:
      'Envia uma mensagem de texto passando por rate-limit (token bucket) e idempotência ' +
      '(clientMessageId). Pode retornar enfileirado (status=queued) quando o limite estoura.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_OUTCOME_SCHEMA })
  sendText(@Param('id') id: string, @Body() dto: SendTextDto) {
    return this.messaging.sendText(id, dto);
  }

  @Post(':id/media')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia mídia',
    description:
      'Envia mídia (image/video/audio/document/sticker) por url pública ou base64 ' +
      '(informe exatamente uma das fontes). Mesmo pacing/idempotência do envio de texto.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_OUTCOME_SCHEMA })
  sendMedia(@Param('id') id: string, @Body() dto: SendMediaDto) {
    return this.messaging.sendMedia(id, dto);
  }

  @Post(':id/poll')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia enquete',
    description:
      'Envia uma enquete nativa; o voto é coletado e agregado em GET :id/poll/:messageId. ' +
      '422 quando a engine não entrega enquete.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_OUTCOME_SCHEMA })
  @ApiResponse({ status: 422, description: 'Engine sem suporte a enquete (capability "poll").' })
  sendPoll(@Param('id') id: string, @Body() dto: SendPollDto) {
    return this.messaging.sendPoll(id, dto);
  }

  @Get(':id/poll/:messageId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Resultado de uma enquete',
    description: 'Agregação de votos (por opção + total de votantes) de uma enquete enviada.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'messageId', description: 'id da mensagem-enquete original.' })
  @ApiOkResponse({ schema: POLL_RESULTS_SCHEMA })
  @ApiResponse({ status: 404, description: 'Enquete não encontrada.' })
  pollResults(@Param('id') id: string, @Param('messageId') messageId: string) {
    return this.messaging.pollResults(id, messageId);
  }

  @Post(':id/buttons')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia botões',
    description:
      'Envia botões de resposta (máx. 3). 422 quando a engine não entrega e fallbackToText=false; ' +
      'com fallbackToText=true, degrada para texto formatado.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_OUTCOME_SCHEMA })
  @ApiResponse({
    status: 422,
    description: 'Engine sem suporte a botões e sem fallbackToText.',
  })
  sendButtons(@Param('id') id: string, @Body() dto: SendButtonsDto) {
    return this.messaging.sendButtons(id, dto);
  }

  @Post(':id/list')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia lista (menu)',
    description:
      'Envia uma lista de opções em seções. 422 quando a engine não entrega e fallbackToText=false; ' +
      'com fallbackToText=true, degrada para texto formatado.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_OUTCOME_SCHEMA })
  @ApiResponse({
    status: 422,
    description: 'Engine sem suporte a lista e sem fallbackToText.',
  })
  sendList(@Param('id') id: string, @Body() dto: SendListDto) {
    return this.messaging.sendList(id, dto);
  }

  @Post(':id/pix')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia botão PIX',
    description:
      'Envia botão PIX (copia-e-cola). Nativo do Baileys; nas demais engines, 422 sem fallbackToText ' +
      'ou degrada para texto com fallbackToText=true.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_OUTCOME_SCHEMA })
  @ApiResponse({
    status: 422,
    description: 'Engine sem suporte a PIX e sem fallbackToText.',
  })
  sendPix(@Param('id') id: string, @Body() dto: SendPixDto) {
    return this.messaging.sendPix(id, dto);
  }

  @Post(':id/location')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia localização',
    description: 'Envia uma mensagem de localização (lat/long, com nome/endereço opcionais).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_OUTCOME_SCHEMA })
  @ApiResponse({ status: 501, description: 'Engine sem suporte a localização.' })
  sendLocation(@Param('id') id: string, @Body() dto: SendLocationDto) {
    return this.messaging.sendLocation(id, dto);
  }

  @Post(':id/contact')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Envia cartões de contato',
    description: 'Envia um ou mais cartões de contato (vCard).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_OUTCOME_SCHEMA })
  @ApiResponse({ status: 501, description: 'Engine sem suporte a envio de contato.' })
  sendContact(@Param('id') id: string, @Body() dto: SendContactDto) {
    return this.messaging.sendContact(id, dto);
  }

  @Post(':id/status')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Posta um Status/Story',
    description:
      'Posta um Status/Story (texto/imagem/vídeo/áudio) — broadcast, fora da fila de envio. ' +
      '501 na Cloud API.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_RESULT_SCHEMA })
  @ApiResponse({ status: 501, description: 'Engine sem suporte a Status (ex.: Cloud API).' })
  sendStatus(@Param('id') id: string, @Body() dto: SendStatusDto) {
    return this.messaging.sendStatus(id, dto);
  }

  @Post(':id/location-request')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Pede a localização do usuário',
    description: 'Envia um pedido de localização (Cloud API). 501 nas demais engines.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_RESULT_SCHEMA })
  @ApiResponse({ status: 501, description: 'Engine sem suporte a pedido de localização.' })
  requestLocation(@Param('id') id: string, @Body() dto: RequestLocationDto) {
    return this.messaging.requestLocation(id, dto);
  }

  @Post(':id/reaction')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Reage a uma mensagem',
    description: 'Reage a uma mensagem (emoji; string vazia remove). 501 se a engine não suporta.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_RESULT_SCHEMA })
  @ApiResponse({ status: 501, description: 'Engine sem suporte a reações.' })
  react(@Param('id') id: string, @Body() dto: ReactMessageDto) {
    return this.messaging.reactMessage(id, dto);
  }

  @Post(':id/edit')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Edita uma mensagem',
    description: 'Edita o texto de uma mensagem já enviada. 501 se a engine não suporta.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_RESULT_SCHEMA })
  @ApiResponse({ status: 501, description: 'Engine sem suporte a edição de mensagem.' })
  edit(@Param('id') id: string, @Body() dto: EditMessageDto) {
    return this.messaging.editMessage(id, dto);
  }

  @Post(':id/delete')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Apaga uma mensagem',
    description: 'Apaga uma mensagem (para todos por padrão). 501 se a engine não suporta.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: SEND_RESULT_SCHEMA })
  @ApiResponse({ status: 501, description: 'Engine sem suporte a exclusão de mensagem.' })
  delete(@Param('id') id: string, @Body() dto: DeleteMessageDto) {
    return this.messaging.deleteMessage(id, dto);
  }

  @Get(':id/status/:messageId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Status de entrega de uma mensagem',
    description:
      'Ack atual + histórico de timestamps (server/entregue/lido/falha) de uma mensagem.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'messageId', description: 'id da mensagem (WhatsApp).' })
  @ApiOkResponse({ schema: MESSAGE_STATUS_SCHEMA })
  @ApiResponse({ status: 404, description: 'Mensagem não encontrada.' })
  async status(@Param('id') id: string, @Param('messageId') messageId: string) {
    const log = await this.messaging.messageStatus(id, messageId);
    return {
      messageId: log.id,
      chatId: log.chatId,
      ack: log.ack,
      history: {
        serverAckAt: log.serverAckAt,
        deliveredAt: log.deliveredAt,
        readAt: log.readAt,
        failedAt: log.failedAt,
      },
      failureReason: log.failureReason ?? null,
    };
  }

  /** Status de um envio que caiu na fila (throttle). */
  @Get(':id/queue/:jobId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Status de um envio enfileirado',
    description: 'Estado de um job de envio que caiu na fila por rate-limit (throttle).',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'jobId', description: 'id do job na fila (retornado quando status=queued).' })
  @ApiOkResponse({ schema: QUEUE_STATUS_SCHEMA })
  @ApiResponse({ status: 404, description: 'Job não encontrado.' })
  queueStatus(@Param('jobId') jobId: string) {
    return this.messaging.queueStatus(jobId);
  }
}
