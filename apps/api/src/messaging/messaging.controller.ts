import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
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
import { MessagingService } from './messaging.service';

@ApiTags('Mensagens')
@ApiSecurity('apikey')
@Controller('messages')
@UseGuards(InstanceApiKeyGuard)
export class MessagingController {
  constructor(private readonly messaging: MessagingService) {}

  @Post(':id/text')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia texto (com rate-limit e idempotência).' })
  sendText(@Param('id') id: string, @Body() dto: SendTextDto) {
    return this.messaging.sendText(id, dto);
  }

  @Post(':id/media')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia mídia (image/video/audio/document/sticker) por url ou base64.' })
  sendMedia(@Param('id') id: string, @Body() dto: SendMediaDto) {
    return this.messaging.sendMedia(id, dto);
  }

  @Post(':id/poll')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia enquete (voto coletado em GET :id/poll/:messageId).' })
  sendPoll(@Param('id') id: string, @Body() dto: SendPollDto) {
    return this.messaging.sendPoll(id, dto);
  }

  @Get(':id/poll/:messageId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Resultado agregado de uma enquete.' })
  pollResults(@Param('id') id: string, @Param('messageId') messageId: string) {
    return this.messaging.pollResults(id, messageId);
  }

  @Post(':id/buttons')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia botões (422 se a engine não entrega; fallbackToText degrada).' })
  sendButtons(@Param('id') id: string, @Body() dto: SendButtonsDto) {
    return this.messaging.sendButtons(id, dto);
  }

  @Post(':id/list')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia lista (menu).' })
  sendList(@Param('id') id: string, @Body() dto: SendListDto) {
    return this.messaging.sendList(id, dto);
  }

  @Post(':id/pix')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia botão PIX (copia-e-cola). Baileys-only, com fallback.' })
  sendPix(@Param('id') id: string, @Body() dto: SendPixDto) {
    return this.messaging.sendPix(id, dto);
  }

  @Post(':id/location')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia uma mensagem de localização (lat/long).' })
  sendLocation(@Param('id') id: string, @Body() dto: SendLocationDto) {
    return this.messaging.sendLocation(id, dto);
  }

  @Post(':id/contact')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Envia um ou mais cartões de contato (vCard).' })
  sendContact(@Param('id') id: string, @Body() dto: SendContactDto) {
    return this.messaging.sendContact(id, dto);
  }

  @Post(':id/reaction')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Reage a uma mensagem (emoji; vazio remove). 501 se a engine não suporta.',
  })
  react(@Param('id') id: string, @Body() dto: ReactMessageDto) {
    return this.messaging.reactMessage(id, dto);
  }

  @Post(':id/edit')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Edita o texto de uma mensagem enviada. 501 se a engine não suporta.' })
  edit(@Param('id') id: string, @Body() dto: EditMessageDto) {
    return this.messaging.editMessage(id, dto);
  }

  @Post(':id/delete')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({ summary: 'Apaga uma mensagem (para todos por padrão). 501 se não suportada.' })
  delete(@Param('id') id: string, @Body() dto: DeleteMessageDto) {
    return this.messaging.deleteMessage(id, dto);
  }

  @Get(':id/status/:messageId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Ack atual + histórico de timestamps de uma mensagem.' })
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
  @ApiOperation({ summary: 'Status de um envio enfileirado (throttle).' })
  queueStatus(@Param('jobId') jobId: string) {
    return this.messaging.queueStatus(jobId);
  }
}
