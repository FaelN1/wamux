import { BadRequestException, Injectable, NotImplementedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InstanceService } from '../instance/instance.service';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import {
  PricingAnalyticsQuery,
  MessagingAnalyticsQuery,
  PhoneNumberInfo,
  RegisterNumberInput,
  RequestCodeInput,
  UpdateProfileInput,
} from '../providers/provider.types';

/** Gestão de conta/WABA (Cloud API). Capability guard → 501 nas outras engines. */
@Injectable()
export class AccountService {
  constructor(
    private readonly manager: InstanceManagerService,
    private readonly instances: InstanceService,
    private readonly config: ConfigService,
  ) {}

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
  async pricingAnalytics(id: string, q: PricingAnalyticsQuery): Promise<unknown> {
    return (await this.cap(id)).pricingAnalytics!(q);
  }

  /** URL do gateway que recebe os webhooks da Meta desta instância. */
  private webhookUrl(id: string): string {
    const base = (this.config.get<string>('publicBaseUrl') ?? '').replace(/\/+$/, '');
    if (!base) {
      throw new BadRequestException('Defina PUBLIC_BASE_URL para configurar o webhook na Meta.');
    }
    return `${base}/api/webhooks/cloud/${id}`;
  }

  /**
   * Aponta o webhook do NÚMERO para a rota desta instância. Usa o verify_token
   * da instância (`config.verifyToken`) ou o global — a Meta faz o handshake GET
   * na hora, então a URL precisa estar acessível publicamente.
   */
  async setWebhookOverride(id: string): Promise<{ callbackUri: string }> {
    const provider = await this.cap(id);
    const inst = await this.instances.findOne(id);
    const verifyToken =
      (inst.config?.verifyToken as string | undefined) ||
      this.config.get<string>('cloudApi.verifyToken');
    if (!verifyToken) {
      throw new BadRequestException('Defina CLOUD_API_VERIFY_TOKEN (ou config.verifyToken).');
    }
    const callbackUri = this.webhookUrl(id);
    await provider.setWebhookOverride!({ callbackUri, verifyToken });
    return { callbackUri };
  }

  async clearWebhookOverride(id: string): Promise<void> {
    return (await this.cap(id)).clearWebhookOverride!();
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
