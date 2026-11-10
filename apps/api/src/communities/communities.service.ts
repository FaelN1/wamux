import {
  BadRequestException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { InstanceManagerService } from '../instance/instance-manager.service';
import { WhatsAppProvider } from '../providers/provider.interface';
import {
  CommunityAdminAction,
  CommunityInfo,
  CommunityInviteProbeResult,
  CommunityLinkedGroup,
  CommunityParticipant,
  CreateCommunityInput,
  GroupParticipantResult,
  SendResult,
  UpdateCommunityImageInput,
} from '../providers/provider.types';
import { SendCommunityAnnouncementDto } from './dto/send-community-announcement.dto';

/** Gerência de comunidades. Capability guard → 501 uniforme quando a engine não suporta. */
@Injectable()
export class CommunitiesService {
  constructor(private readonly manager: InstanceManagerService) {}

  async list(id: string, onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]> {
    return (await this.requireCapable(id)).listCommunities!(onlyOwnedOrAdmin);
  }
  async metadata(id: string, jid: string): Promise<CommunityInfo> {
    return (await this.requireCapable(id)).communityMetadata!(jid);
  }
  async create(id: string, input: CreateCommunityInput): Promise<CommunityInfo> {
    return (await this.requireCapable(id)).createCommunity!(input);
  }
  async remove(id: string, jid: string): Promise<void> {
    return (await this.requireCapable(id)).deleteCommunity!(jid);
  }
  async setSubject(id: string, jid: string, subject: string): Promise<void> {
    return (await this.requireCapable(id)).updateCommunitySubject!(jid, subject);
  }
  async setDescription(id: string, jid: string, description: string): Promise<void> {
    return (await this.requireCapable(id)).updateCommunityDescription!(jid, description);
  }
  async setImage(id: string, jid: string, image: UpdateCommunityImageInput): Promise<void> {
    if (!image.url && !image.base64) {
      throw new BadRequestException('Informe "url" ou "base64" para a imagem.');
    }
    return (await this.requireCapable(id)).updateCommunityImage!(jid, image);
  }
  async updateAdmins(
    id: string,
    jid: string,
    members: string[],
    action: CommunityAdminAction,
  ): Promise<GroupParticipantResult[]> {
    return (await this.requireCapable(id)).updateCommunityAdmins!(jid, members, action);
  }
  async listMembers(id: string, jid: string): Promise<CommunityParticipant[]> {
    return (await this.requireCapable(id)).listCommunityMembers!(jid);
  }
  async countMembers(id: string, jid: string): Promise<{ count: number }> {
    return { count: await (await this.requireCapable(id)).countCommunityMembers!(jid) };
  }
  async getInvite(id: string, jid: string): Promise<{ code: string; url: string }> {
    const code = await (await this.requireCapable(id)).getCommunityInviteCode!(jid);
    return { code, url: code ? `https://chat.whatsapp.com/${code}` : '' };
  }
  async revokeInvite(id: string, jid: string): Promise<{ code: string; url: string }> {
    const code = await (await this.requireCapable(id)).revokeCommunityInviteCode!(jid);
    return { code, url: code ? `https://chat.whatsapp.com/${code}` : '' };
  }
  async probeInvite(id: string, jid: string): Promise<CommunityInviteProbeResult> {
    return (await this.requireCapable(id)).probeCommunityInvite!(jid);
  }
  async listLinkedGroups(id: string, jid: string): Promise<CommunityLinkedGroup[]> {
    return (await this.requireCapable(id)).listCommunityLinkedGroups!(jid);
  }
  async linkGroup(id: string, jid: string, groupJid: string): Promise<void> {
    return (await this.requireCapable(id)).linkGroupToCommunity!(groupJid, jid);
  }
  async unlinkGroup(id: string, jid: string, groupJid: string): Promise<void> {
    return (await this.requireCapable(id)).unlinkGroupFromCommunity!(groupJid, jid);
  }
  async syncOne(id: string, jid: string): Promise<CommunityInfo> {
    return (await this.requireCapable(id)).syncCommunity!(jid);
  }
  async syncAll(id: string, onlyOwnedOrAdmin?: boolean): Promise<CommunityInfo[]> {
    return (await this.requireCapable(id)).syncAllCommunities!(onlyOwnedOrAdmin);
  }

  /**
   * Publica no grupo de anúncios de uma ou mais comunidades. Não é um método
   * de provider dedicado — resolve o `announcementGroupJid` via
   * `communityMetadata` e reaproveita `sendText`/`sendMedia` (mesmo caminho de
   * rate-limit/idempotência que qualquer outro envio).
   */
  async sendAnnouncement(
    id: string,
    jid: string,
    dto: SendCommunityAnnouncementDto,
  ): Promise<SendResult[]> {
    const hasMedia = Boolean(dto.mediaUrl || dto.mediaBase64);
    if (!dto.text && !hasMedia) {
      throw new BadRequestException(
        'Informe "text" ou mídia (mediaUrl/mediaBase64) para o anúncio.',
      );
    }

    const provider = await this.requireCapable(id);
    const targets = [jid, ...(dto.communities ?? [])];
    const results: SendResult[] = [];

    for (const communityJid of targets) {
      const info = await provider.communityMetadata!(communityJid);
      const to = info.announcementGroupJid;
      if (!to) {
        throw new NotFoundException(
          `Grupo de anúncios da comunidade ${communityJid} ainda não foi descoberto ` +
            `(ver evento communities.announcement.discovered) — tente novamente em instantes.`,
        );
      }

      if (hasMedia) {
        results.push(
          await provider.sendMedia({
            to,
            type: dto.mediaType ?? 'image',
            url: dto.mediaUrl,
            base64: dto.mediaBase64,
            caption: dto.caption ?? dto.text,
            filename: dto.filename,
            mimetype: dto.mimetype,
          }),
        );
      } else {
        results.push(await provider.sendText({ to, text: dto.text! }));
      }
    }

    return results;
  }

  private async requireCapable(id: string): Promise<WhatsAppProvider> {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.communities || !provider.listCommunities) {
      throw new NotImplementedException(`A engine "${provider.type}" não suporta comunidades.`);
    }
    return provider;
  }
}
