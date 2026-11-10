import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { ApiKeyAction, VoiceCallEndReason } from '@wamux/shared';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { CallsService } from './calls.service';
import { StartCallDto } from './dto/start-call.dto';
import { PlayCallAudioDto } from './dto/play-audio.dto';
import { EndCallDto, MuteCallDto } from './dto/end-call.dto';

@ApiTags('Chamadas de voz (VoIP)')
@ApiSecurity('apikey')
@Controller('instances/:id/calls')
@UseGuards(InstanceApiKeyGuard)
export class CallsController {
  constructor(private readonly svc: CallsService) {}

  @Get()
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Lista as chamadas conhecidas desta instância.' })
  list(@Param('id') id: string) {
    return this.svc.list(id);
  }

  @Post()
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary: 'Inicia uma chamada de voz (501 quando a engine não suporta VoIP).',
  })
  start(@Param('id') id: string, @Body() dto: StartCallDto) {
    return this.svc.start(id, dto);
  }

  @Get(':callId')
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({ summary: 'Estado atual de uma chamada.' })
  get(@Param('id') id: string, @Param('callId') callId: string) {
    return this.svc.get(id, callId);
  }

  @Post(':callId/accept')
  @HttpCode(200)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Atende uma chamada recebida que está tocando.' })
  accept(@Param('id') id: string, @Param('callId') callId: string) {
    return this.svc.accept(id, callId);
  }

  @Post(':callId/reject')
  @HttpCode(204)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Rejeita uma chamada que está tocando (default: declined).' })
  reject(@Param('id') id: string, @Param('callId') callId: string, @Body() dto: EndCallDto) {
    return this.svc.reject(id, callId, dto.reason ?? VoiceCallEndReason.DECLINED);
  }

  @Post(':callId/end')
  @HttpCode(204)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Encerra uma chamada ativa ou conectando (default: user_ended).' })
  end(@Param('id') id: string, @Param('callId') callId: string, @Body() dto: EndCallDto) {
    return this.svc.end(id, callId, dto.reason ?? VoiceCallEndReason.USER_ENDED);
  }

  @Post(':callId/mute')
  @HttpCode(204)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({ summary: 'Silencia (ou reativa) o áudio local da chamada.' })
  mute(@Param('id') id: string, @Param('callId') callId: string, @Body() dto: MuteCallDto) {
    return this.svc.mute(id, callId, dto.muted ?? true);
  }

  @Post(':callId/audio')
  @HttpCode(204)
  @RequireScope(ApiKeyAction.SEND)
  @ApiOperation({
    summary:
      'Toca um áudio na chamada (gated por capabilities.voiceCallAudio — precisa de ffmpeg).',
  })
  playAudio(
    @Param('id') id: string,
    @Param('callId') callId: string,
    @Body() dto: PlayCallAudioDto,
  ) {
    return this.svc.playAudio(id, callId, dto);
  }
}
