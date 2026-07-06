import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SettingsService } from '../settings/settings.service';
import { IdentityService } from '../identity/identity.service';
import { WhatsAppProvider, ProviderContext } from './provider.interface';
import { IdentityMode, ProviderType, SessionStore } from './provider.types';
import { BaileysProvider } from './baileys/baileys.provider';
import { WebjsProvider } from './webjs/webjs.provider';
import { CloudApiProvider } from './cloud/cloud-api.provider';
import { WhatsmeowProvider } from './whatsmeow/whatsmeow.provider';

/**
 * Instancia o adapter correto para o tipo de provider escolhido na criação
 * da instância. Único ponto que conhece as classes concretas — o resto do
 * sistema só lida com a interface `WhatsAppProvider`.
 */
@Injectable()
export class ProviderFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly settings: SettingsService,
    private readonly identity: IdentityService,
  ) {}

  create(type: ProviderType, ctx: ProviderContext): WhatsAppProvider {
    switch (type) {
      case ProviderType.BAILEYS:
        return new BaileysProvider(ctx);
      case ProviderType.WEBJS:
        return new WebjsProvider(ctx);
      case ProviderType.CLOUD_API:
        return new CloudApiProvider(ctx);
      case ProviderType.WHATSMEOW:
        return new WhatsmeowProvider(ctx);
      default:
        throw new Error(`Provider não suportado: ${type as string}`);
    }
  }

  /**
   * Monta o contexto do provider. Injeta defaults globais (base URL da Cloud
   * API, URL/token do sidecar whatsmeow) que a config da instância pode
   * sobrescrever.
   */
  buildContext(
    instanceId: string,
    instanceConfig: Record<string, unknown>,
    sessionStore: SessionStore,
    identityMode: IdentityMode = 'auto',
  ): ProviderContext {
    const cloudApi = this.config.get<Record<string, string>>('cloudApi') ?? {};
    const whatsmeow = this.config.get<Record<string, string>>('whatsmeow') ?? {};
    const device = this.settings.get().device;

    const config: Record<string, unknown> = {
      cloudApiBaseUrl: cloudApi.baseUrl,
      cloudApiVersion: cloudApi.version,
      whatsmeowUrl: whatsmeow.url,
      whatsmeowMasterKey: whatsmeow.masterKey,
      whatsmeowCallbackBaseUrl: whatsmeow.callbackBaseUrl,
      // Identidade no WhatsApp ("Aparelhos conectados") — lida a cada spawn,
      // então mudanças no painel valem no próximo connect.
      deviceClient: device.client,
      deviceBrowser: device.browser,
      ...instanceConfig, // a instância pode sobrescrever qualquer default
    };

    return {
      instanceId,
      config,
      sessionStore,
      logger: new Logger(`provider:${instanceId}`),
      identity: this.identity,
      identityMode,
    };
  }
}
