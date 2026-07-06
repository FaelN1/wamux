import { Injectable, NotImplementedException } from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import {
  CreateGroupInput,
  GroupInfo,
  GroupParticipantAction,
  GroupParticipantResult,
  GroupSetting,
} from '../providers/provider.types';

/** Gerência de grupos. Capability guard → 501 uniforme quando a engine não suporta. */
@Injectable()
export class GroupsService {
  constructor(private readonly manager: InstanceManagerService) {}

  async list(id: string): Promise<GroupInfo[]> {
    return (await this.requireCapable(id)).listGroups!();
  }
  async metadata(id: string, jid: string): Promise<GroupInfo> {
    return (await this.requireCapable(id)).groupMetadata!(jid);
  }
  async create(id: string, input: CreateGroupInput): Promise<GroupInfo> {
    return (await this.requireCapable(id)).createGroup!(input);
  }
  async updateParticipants(
    id: string,
    jid: string,
    participants: string[],
    action: GroupParticipantAction,
  ): Promise<GroupParticipantResult[]> {
    return (await this.requireCapable(id)).updateGroupParticipants!(jid, participants, action);
  }
  async setSubject(id: string, jid: string, subject: string): Promise<void> {
    return (await this.requireCapable(id)).updateGroupSubject!(jid, subject);
  }
  async setDescription(id: string, jid: string, description: string): Promise<void> {
    return (await this.requireCapable(id)).updateGroupDescription!(jid, description);
  }
  async setSetting(id: string, jid: string, setting: GroupSetting): Promise<void> {
    return (await this.requireCapable(id)).updateGroupSetting!(jid, setting);
  }
  async getInvite(id: string, jid: string): Promise<{ code: string; url: string }> {
    const code = await (await this.requireCapable(id)).getGroupInviteCode!(jid);
    return { code, url: code ? `https://chat.whatsapp.com/${code}` : '' };
  }
  async revokeInvite(id: string, jid: string): Promise<{ code: string; url: string }> {
    const code = await (await this.requireCapable(id)).revokeGroupInviteCode!(jid);
    return { code, url: code ? `https://chat.whatsapp.com/${code}` : '' };
  }
  async join(id: string, code: string): Promise<{ jid: string }> {
    return (await this.requireCapable(id)).joinGroupViaInvite!(code);
  }
  async leave(id: string, jid: string): Promise<void> {
    return (await this.requireCapable(id)).leaveGroup!(jid);
  }

  private async requireCapable(id: string): Promise<WhatsAppProvider> {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.groups || !provider.listGroups) {
      throw new NotImplementedException(`A engine "${provider.type}" não suporta grupos.`);
    }
    return provider;
  }
}
