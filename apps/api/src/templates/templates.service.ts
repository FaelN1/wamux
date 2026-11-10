import { Injectable, NotImplementedException } from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import {
  CreateTemplateInput,
  CreateTemplateResult,
  DeleteTemplateInput,
  EditTemplatePatch,
  MessageTemplate,
  SendResult,
  SendTemplateInput,
  TemplateAnalyticsQuery,
  TemplateFilter,
} from '../providers/provider.types';

/** Templates HSM (Cloud API). Capability guard → 501 uniforme nas outras engines. */
@Injectable()
export class TemplatesService {
  constructor(private readonly manager: InstanceManagerService) {}

  async list(id: string, filter?: TemplateFilter): Promise<MessageTemplate[]> {
    return (await this.cap(id)).listTemplates!(filter);
  }
  async get(id: string, idOrName: string): Promise<MessageTemplate> {
    return (await this.cap(id)).getTemplate!(idOrName);
  }
  async create(id: string, input: CreateTemplateInput): Promise<CreateTemplateResult> {
    return (await this.cap(id)).createTemplate!(input);
  }
  async edit(id: string, templateId: string, patch: EditTemplatePatch): Promise<void> {
    return (await this.cap(id)).editTemplate!(templateId, patch);
  }
  async remove(id: string, input: DeleteTemplateInput): Promise<void> {
    return (await this.cap(id)).deleteTemplate!(input);
  }
  async send(id: string, input: SendTemplateInput): Promise<SendResult> {
    return (await this.cap(id)).sendTemplate!(input);
  }
  async analytics(id: string, query: TemplateAnalyticsQuery): Promise<unknown> {
    return (await this.cap(id)).templateAnalytics!(query);
  }

  private async cap(id: string): Promise<WhatsAppProvider> {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.templates || !provider.listTemplates) {
      throw new NotImplementedException(
        `A engine "${provider.type}" não suporta templates (Cloud API oficial).`,
      );
    }
    return provider;
  }
}
