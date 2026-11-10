import { BadRequestException, Injectable, NotImplementedException } from '@nestjs/common';
import { FlowSessionService } from '../flow-sessions/flow-session.service';
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
  constructor(
    private readonly manager: InstanceManagerService,
    private readonly flowSessions: FlowSessionService,
  ) {}

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
  async send(
    id: string,
    input: SendTemplateInput,
  ): Promise<SendResult & { route: 'cloud' | 'marketing' }> {
    const route = input.route ?? 'cloud';
    if (route !== 'marketing') {
      if (input.productPolicy || input.messageActivitySharing != null) {
        throw new BadRequestException(
          '"productPolicy" e "messageActivitySharing" só valem com route=marketing.',
        );
      }
    } else if (input.quotedMessageId) {
      throw new BadRequestException('A Marketing Messages API não aceita reply (quotedMessageId).');
    }
    const result = await (await this.cap(id)).sendTemplate!(input);

    // Template com botão FLOW: abre a sessão de correlação pelo flow_token, como
    // no envio direto de Flow — a resposta fecha a sessão do mesmo jeito.
    for (const c of input.components ?? []) {
      if (c.type !== 'button' || c.sub_type !== 'flow') continue;
      for (const p of c.parameters) {
        const token = p.type === 'action' ? p.action.flow_token : undefined;
        if (token) {
          await this.flowSessions.recordSent(id, {
            flowToken: token,
            flowName: `template:${input.name}`,
            contact: result.to,
            messageId: result.id,
          });
        }
      }
    }
    return { ...result, route };
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
