import { Injectable, NotImplementedException } from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import {
  FetchMessagesPage,
  PresenceInfo,
  SetPresenceInput,
} from '../providers/provider.types';

/** Endpoints de conveniência. Gate de capability → 501 uniforme. */
@Injectable()
export class ContactsService {
  constructor(private readonly manager: InstanceManagerService) {}

  async block(instanceId: string, jid: string): Promise<void> {
    return (await this.cap(instanceId, 'block', (p) => p.blockContact)).blockContact!(jid);
  }
  async unblock(instanceId: string, jid: string): Promise<void> {
    return (await this.cap(instanceId, 'block', (p) => p.unblockContact)).unblockContact!(jid);
  }
  async setPresence(instanceId: string, input: SetPresenceInput): Promise<void> {
    return (await this.cap(instanceId, 'presence', (p) => p.setPresence)).setPresence!(input);
  }
  async getPresence(instanceId: string, jid: string): Promise<PresenceInfo> {
    return (await this.cap(instanceId, 'presence', (p) => p.getPresence)).getPresence!(jid);
  }
  async fetchMessages(
    instanceId: string,
    chatId: string,
    limit: number,
    before?: string,
  ): Promise<FetchMessagesPage> {
    const p = await this.cap(instanceId, 'fetchMessages', (x) => x.fetchMessages);
    return p.fetchMessages!(chatId, { limit, before });
  }
  async markRead(instanceId: string, chatId: string, messageIds?: string[]): Promise<void> {
    return (await this.cap(instanceId, 'markRead', (p) => p.markRead)).markRead!(chatId, messageIds);
  }

  /** Provider vivo que suporta `flag` E expõe o método. Único ponto de 501. */
  private async cap(
    instanceId: string,
    flag: keyof WhatsAppProvider['capabilities'],
    pick: (p: WhatsAppProvider) => unknown,
  ): Promise<WhatsAppProvider> {
    const provider = await this.manager.requireLive(instanceId);
    if (!provider.capabilities[flag] || typeof pick(provider) !== 'function') {
      throw new NotImplementedException(
        `A engine "${provider.type}" não suporta esta operação (${String(flag)}).`,
      );
    }
    return provider;
  }
}
