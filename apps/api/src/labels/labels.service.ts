import { Injectable, NotImplementedException } from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import { Label, LabelTarget, UpsertLabelInput } from '../providers/provider.types';

/**
 * CRUD canônico de etiquetas. Delega ao provider vivo; o gate de
 * capability é o único ponto de 501 — o controller nunca decide por engine.
 */
@Injectable()
export class LabelsService {
  constructor(private readonly manager: InstanceManagerService) {}

  async list(instanceId: string): Promise<Label[]> {
    return (await this.withLabels(instanceId)).listLabels!();
  }

  async upsert(instanceId: string, input: UpsertLabelInput): Promise<Label> {
    const p = await this.withLabels(instanceId);
    if (!p.upsertLabel) {
      throw new NotImplementedException(
        `A engine "${p.type}" lista/associa etiquetas mas não cria/edita (use o app WhatsApp Business).`,
      );
    }
    return p.upsertLabel(input);
  }

  async remove(instanceId: string, labelId: string): Promise<void> {
    const p = await this.withLabels(instanceId);
    if (!p.deleteLabel) {
      throw new NotImplementedException(`A engine "${p.type}" não remove etiquetas por API.`);
    }
    return p.deleteLabel(labelId);
  }

  async setAssociation(
    instanceId: string,
    labelId: string,
    target: LabelTarget,
    on: boolean,
  ): Promise<void> {
    return (await this.withLabels(instanceId)).setLabelForTarget!(labelId, target, on);
  }

  async labelsForTarget(instanceId: string, target: LabelTarget): Promise<Label[]> {
    return (await this.withLabels(instanceId)).getLabelsForTarget!(target);
  }

  async chatsForLabel(instanceId: string, labelId: string): Promise<string[]> {
    const p = await this.withLabels(instanceId);
    if (!p.getChatsForLabel) {
      throw new NotImplementedException(`A engine "${p.type}" não lista chats por etiqueta.`);
    }
    return p.getChatsForLabel(labelId);
  }

  /** Garante um provider vivo que declara suporte a etiquetas (WhatsApp Business). */
  private async withLabels(instanceId: string): Promise<WhatsAppProvider> {
    const provider = await this.manager.requireLive(instanceId);
    if (!provider.capabilities.labels || !provider.listLabels) {
      throw new NotImplementedException(
        `A engine "${provider.type}" não suporta etiquetas (requer WhatsApp Business).`,
      );
    }
    return provider;
  }
}
