import { Injectable, NotImplementedException } from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import {
  ConversationAnalyticsQuery,
  MessagingAnalyticsQuery,
  PhoneNumberInfo,
  RegisterNumberInput,
  RequestCodeInput,
  UpdateProfileInput,
} from '../providers/provider.types';

/** Gestão de conta/WABA (Cloud API). Capability guard → 501 nas outras engines. */
@Injectable()
export class AccountService {
  constructor(private readonly manager: InstanceManagerService) {}

  async updateProfile(id: string, input: UpdateProfileInput): Promise<void> {
    const p = await this.manager.requireLive(id);
    if (!p.capabilities.updateProfile || !p.updateProfile) {
      throw new NotImplementedException(
        `A engine "${p.type}" não suporta atualizar o perfil de negócio.`,
      );
    }
    return p.updateProfile(input);
  }

  async listPhoneNumbers(id: string): Promise<PhoneNumberInfo[]> {
    return (await this.cap(id)).listPhoneNumbers!();
  }
  async getPhoneNumber(id: string): Promise<PhoneNumberInfo> {
    return (await this.cap(id)).getPhoneNumber!();
  }
  async requestCode(id: string, input: RequestCodeInput): Promise<void> {
    return (await this.cap(id)).requestVerificationCode!(input);
  }
  async verifyCode(id: string, code: string): Promise<void> {
    return (await this.cap(id)).verifyCode!(code);
  }
  async register(id: string, input: RegisterNumberInput): Promise<void> {
    return (await this.cap(id)).registerNumber!(input);
  }
  async deregister(id: string): Promise<void> {
    return (await this.cap(id)).deregisterNumber!();
  }
  async setPin(id: string, pin: string): Promise<void> {
    return (await this.cap(id)).setTwoStepPin!(pin);
  }
  async wabaInfo(id: string): Promise<unknown> {
    return (await this.cap(id)).getWabaInfo!();
  }
  async subscribe(id: string): Promise<unknown> {
    return (await this.cap(id)).subscribeApp!();
  }
  async subscribedApps(id: string): Promise<unknown> {
    return (await this.cap(id)).listSubscribedApps!();
  }
  async unsubscribe(id: string): Promise<void> {
    return (await this.cap(id)).unsubscribeApp!();
  }
  async analytics(id: string, q: MessagingAnalyticsQuery): Promise<unknown> {
    return (await this.cap(id)).messagingAnalytics!(q);
  }
  async conversationAnalytics(id: string, q: ConversationAnalyticsQuery): Promise<unknown> {
    return (await this.cap(id)).conversationAnalytics!(q);
  }

  private async cap(id: string): Promise<WhatsAppProvider> {
    const p = await this.manager.requireLive(id);
    if (!p.capabilities.cloudAccount || !p.listPhoneNumbers) {
      throw new NotImplementedException(
        `A engine "${p.type}" não suporta gestão de conta (Cloud API oficial).`,
      );
    }
    return p;
  }
}
