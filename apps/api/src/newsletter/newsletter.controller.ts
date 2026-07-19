import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { NewsletterService } from './newsletter.service';
import { CreateNewsletterDto } from './dto/create-newsletter.dto';
import { SendNewsletterMessageDto } from './dto/send-newsletter-message.dto';

@ApiTags('Canais (Newsletter)')
@ApiSecurity('apikey')
@Controller('instances/:id/newsletters')
@UseGuards(InstanceApiKeyGuard)
export class NewsletterController {
  constructor(private readonly svc: NewsletterService) {}

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista os canais seguidos.' })
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post()
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Cria um canal.' })
  create(@Param('id') id: string, @Body() dto: CreateNewsletterDto) {
    return this.svc.create(id, dto);
  }

  @Get(':jid')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Metadados de um canal.' })
  meta(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.metadata(id, jid);
  }

  @Post(':jid/follow')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Segue um canal.' })
  follow(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.follow(id, jid);
  }

  @Delete(':jid/follow')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.DELETE)
  @ApiOperation({ summary: 'Deixa de seguir um canal.' })
  unfollow(@Param('id') id: string, @Param('jid') jid: string) {
    return this.svc.unfollow(id, jid);
  }

  @Post(':jid/message')
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Publica no canal (texto sempre; mídia só se capabilities.newsletterMedia).',
  })
  sendMessage(
    @Param('id') id: string,
    @Param('jid') jid: string,
    @Body() dto: SendNewsletterMessageDto,
  ) {
    return this.svc.sendMessage(id, jid, dto);
  }
}
