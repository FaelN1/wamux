import { Injectable, NotImplementedException } from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import { GroupInfo } from '../providers/provider.types';

/**
 * Grupos da Cloud API (Groups API — OBA-gated, máx 8). Distinto de `groups/`
 * (baileys/whatsmeow). Capability guard `cloudGroups` → 501 nas outras engines.
 */
@Injectable()
export class CloudGroupsService {
  constructor(private readonly manager: InstanceManagerService) {}

  async list(id: string): Promise<GroupInfo[]> {
    return (await this.cap(id)).listCloudGroups!();
  }
  async get(id: string, groupId: string): Promise<GroupInfo> {
    return (await this.cap(id)).getCloudGroup!(groupId);
  }
  async create(
    id: string,
    input: { subject: string; participants?: string[] },
  ): Promise<GroupInfo> {
    return (await this.cap(id)).createCloudGroup!(input);
  }
  async remove(id: string, groupId: string): Promise<void> {
    return (await this.cap(id)).deleteCloudGroup!(groupId);
  }
  async invite(id: string, groupId: string): Promise<{ code: string; url: string }> {
    return (await this.cap(id)).getCloudGroupInvite!(groupId);
  }
  async resetInvite(id: string, groupId: string): Promise<{ code: string; url: string }> {
    return (await this.cap(id)).resetCloudGroupInvite!(groupId);
  }
  async removeParticipant(id: string, groupId: string, waId: string): Promise<void> {
    return (await this.cap(id)).removeCloudGroupParticipant!(groupId, waId);
  }

  private async cap(id: string): Promise<WhatsAppProvider> {
    const p = await this.manager.requireLive(id);
    if (!p.capabilities.cloudGroups || !p.listCloudGroups) {
      throw new NotImplementedException(
        `A engine "${p.type}" não suporta grupos da Cloud API (Groups API).`,
      );
    }
    return p;
  }
}
