import { Injectable, NotImplementedException } from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import { CreateNewsletterInput, NewsletterInfo } from '../providers/provider.types';

/** Gerência de canais (@newsletter). Capability guard → 501 uniforme. */
@Injectable()
export class NewsletterService {
  constructor(private readonly manager: InstanceManagerService) {}

  async list(id: string): Promise<NewsletterInfo[]> {
    return (await this.requireCapable(id)).listNewsletters!();
  }
  async create(id: string, input: CreateNewsletterInput): Promise<NewsletterInfo> {
    return (await this.requireCapable(id)).createNewsletter!(input);
  }
  async metadata(id: string, jid: string): Promise<NewsletterInfo> {
    return (await this.requireCapable(id)).newsletterMetadata!(jid);
  }
  async follow(id: string, jid: string): Promise<void> {
    return (await this.requireCapable(id)).followNewsletter!(jid);
  }
  async unfollow(id: string, jid: string): Promise<void> {
    return (await this.requireCapable(id)).unfollowNewsletter!(jid);
  }

  private async requireCapable(id: string): Promise<WhatsAppProvider> {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.newsletter || !provider.listNewsletters) {
      throw new NotImplementedException(
        `A engine "${provider.type}" não suporta canais (newsletter).`,
      );
    }
    return provider;
  }
}
