import { Injectable, NotImplementedException } from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import { ConnectCallInput, SendResult } from '../providers/provider.types';

/**
 * WhatsApp Business Calling API (Cloud) — só sinalização. Capability guard
 * `calling` → 501 nas outras engines. A mídia WebRTC é externa ao gateway.
 */
@Injectable()
export class CallingService {
  constructor(private readonly manager: InstanceManagerService) {}

  async configure(id: string, settings: unknown): Promise<void> {
    return (await this.cap(id)).configureCalling!(settings);
  }
  async getSettings(id: string): Promise<unknown> {
    return (await this.cap(id)).getCallingSettings!();
  }
  async requestPermission(id: string, to: string, text?: string): Promise<SendResult> {
    return (await this.cap(id)).requestCallPermission!(to, text);
  }
  async getPermission(id: string, waId: string): Promise<unknown> {
    return (await this.cap(id)).getCallPermission!(waId);
  }
  async action(id: string, input: ConnectCallInput): Promise<{ id?: string }> {
    return (await this.cap(id)).connectCall!(input);
  }

  private async cap(id: string): Promise<WhatsAppProvider> {
    const p = await this.manager.requireLive(id);
    if (!p.capabilities.calling || !p.connectCall) {
      throw new NotImplementedException(
        `A engine "${p.type}" não suporta chamadas (Cloud Calling API).`,
      );
    }
    return p;
  }
}
