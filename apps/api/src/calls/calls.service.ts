import {
  BadRequestException,
  Injectable,
  NotFoundException,
  NotImplementedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import { VoiceCallEndReason, VoiceCallInfo } from '../providers/provider.types';
import { StartCallDto } from './dto/start-call.dto';
import { PlayCallAudioDto } from './dto/play-audio.dto';

/**
 * Chamadas de voz reais (VoIP). Capability guard → 501 uniforme, igual aos
 * demais módulos gated (grupos, canais, comunidades).
 *
 * Hoje só a engine `zapo` implementa: ela termina a mídia dentro do gateway
 * (`@zapo-js/voip`). A Calling API da Cloud NÃO entra aqui — ela só troca
 * sinalização e vive em `connectCall` (`capabilities.calling`).
 */
@Injectable()
export class CallsService {
  constructor(private readonly manager: InstanceManagerService) {}

  async start(id: string, dto: StartCallDto): Promise<VoiceCallInfo> {
    const provider = await this.requireCapable(id);
    return provider.startVoiceCall!({
      to: dto.to,
      isVideo: dto.isVideo,
      audioUrl: dto.audioUrl,
    });
  }

  async accept(id: string, callId: string): Promise<VoiceCallInfo> {
    return (await this.requireCapable(id)).acceptVoiceCall!(callId);
  }

  async reject(id: string, callId: string, reason?: VoiceCallEndReason): Promise<void> {
    return (await this.requireCapable(id)).rejectVoiceCall!(callId, reason);
  }

  async end(id: string, callId: string, reason?: VoiceCallEndReason): Promise<void> {
    return (await this.requireCapable(id)).endVoiceCall!(callId, reason);
  }

  async mute(id: string, callId: string, muted: boolean): Promise<void> {
    return (await this.requireCapable(id)).setVoiceCallMute!(callId, muted);
  }

  async list(id: string): Promise<VoiceCallInfo[]> {
    return (await this.requireCapable(id)).listVoiceCalls!();
  }

  async get(id: string, callId: string): Promise<VoiceCallInfo> {
    const call = (await this.requireCapable(id)).getVoiceCall!(callId);
    if (!call) throw new NotFoundException(`Chamada "${callId}" não encontrada nesta instância.`);
    return call;
  }

  /**
   * Tocar áudio é gated à parte de `voiceCalls`: depende do ffmpeg no PATH,
   * que pode faltar mesmo numa engine que faz chamadas.
   */
  async playAudio(id: string, callId: string, dto: PlayCallAudioDto): Promise<void> {
    if (!dto.url && !dto.base64) {
      throw new BadRequestException('Informe "url" ou "base64" com o áudio a tocar.');
    }
    const provider = await this.requireCapable(id);
    if (!provider.capabilities.voiceCallAudio || !provider.playVoiceCallAudio) {
      throw new UnprocessableEntityException({
        code: 'voiceCallAudioUnsupported',
        provider: provider.type,
        message: `Tocar áudio em chamada não é suportado na engine "${provider.type}".`,
      });
    }
    return provider.playVoiceCallAudio(callId, { url: dto.url, base64: dto.base64 });
  }

  private async requireCapable(id: string): Promise<WhatsAppProvider> {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.voiceCalls || !provider.startVoiceCall) {
      throw new NotImplementedException(
        `A engine "${provider.type}" não suporta chamadas de voz (VoIP).`,
      );
    }
    return provider;
  }
}
