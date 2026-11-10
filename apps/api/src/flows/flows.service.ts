import { Injectable, NotImplementedException } from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import {
  CreateFlowInput,
  CreateFlowResult,
  Flow,
  FlowMetricsQuery,
  SendFlowInput,
  SendResult,
} from '../providers/provider.types';

/** WhatsApp Flows (Cloud API). Capability guard → 501 nas outras engines. */
@Injectable()
export class FlowsService {
  constructor(private readonly manager: InstanceManagerService) {}

  async list(id: string): Promise<Flow[]> {
    return (await this.cap(id)).listFlows!();
  }
  async get(id: string, flowId: string): Promise<Flow> {
    return (await this.cap(id)).getFlow!(flowId);
  }
  async create(id: string, input: CreateFlowInput): Promise<CreateFlowResult> {
    return (await this.cap(id)).createFlow!(input);
  }
  async updateJson(
    id: string,
    flowId: string,
    flowJson: string,
  ): Promise<{ validation_errors: unknown[] }> {
    return (await this.cap(id)).updateFlowJson!(flowId, flowJson);
  }
  async publish(id: string, flowId: string): Promise<void> {
    return (await this.cap(id)).publishFlow!(flowId);
  }
  async deprecate(id: string, flowId: string): Promise<void> {
    return (await this.cap(id)).deprecateFlow!(flowId);
  }
  async remove(id: string, flowId: string): Promise<void> {
    return (await this.cap(id)).deleteFlow!(flowId);
  }
  async send(id: string, input: SendFlowInput): Promise<SendResult> {
    return (await this.cap(id)).sendFlow!(input);
  }
  async metrics(id: string, flowId: string, q: FlowMetricsQuery): Promise<unknown> {
    return (await this.cap(id)).flowMetrics!(flowId, q);
  }

  private async cap(id: string): Promise<WhatsAppProvider> {
    const p = await this.manager.requireLive(id);
    if (!p.capabilities.flows || !p.listFlows) {
      throw new NotImplementedException(
        `A engine "${p.type}" não suporta Flows (Cloud API oficial).`,
      );
    }
    return p;
  }
}
