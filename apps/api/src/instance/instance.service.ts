import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomUUID } from 'node:crypto';
import { Repository } from 'typeorm';
import { EMPTY_EVENTS_CONFIG, InstanceEventsConfig } from '@wamux/shared';
import { ConnectionStatus } from '../providers/provider.types';
import { MessageLogEntity } from '../messaging/message-log.entity';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { InstanceEntity } from './instance.entity';

/**
 * CRUD dos metadados de instância (Postgres). Não gerencia conexões vivas —
 * isso é responsabilidade do InstanceManagerService.
 */
@Injectable()
export class InstanceService {
  constructor(
    @InjectRepository(InstanceEntity)
    private readonly repo: Repository<InstanceEntity>,
    @InjectRepository(MessageLogEntity)
    private readonly messages: Repository<MessageLogEntity>,
  ) {}

  /**
   * Timestamp da última mensagem (enviada ou recebida) de cada instância —
   * `MAX(createdAt)` agrupado por `instanceId`. Instâncias sem mensagens não
   * aparecem no mapa. Usado para ordenar/filtrar por "última atividade".
   */
  async lastActivityMap(): Promise<Map<string, Date>> {
    const rows = await this.messages
      .createQueryBuilder('m')
      .select('m.instanceId', 'instanceId')
      .addSelect('MAX(m.createdAt)', 'lastAt')
      .groupBy('m.instanceId')
      .getRawMany<{ instanceId: string; lastAt: string | Date }>();
    const map = new Map<string, Date>();
    for (const r of rows) if (r.lastAt) map.set(r.instanceId, new Date(r.lastAt));
    return map;
  }

  async create(dto: CreateInstanceDto): Promise<InstanceEntity> {
    const existing = await this.repo.findOne({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`Já existe instância com o nome "${dto.name}"`);
    }
    const entity = this.repo.create({
      id: randomUUID(),
      name: dto.name,
      provider: dto.provider,
      apiKey: `wa_${randomBytes(24).toString('hex')}`,
      webhookSecret: `whsec_${randomBytes(24).toString('hex')}`,
      status: ConnectionStatus.DISCONNECTED,
      config: dto.config ?? {},
      webhookUrl: dto.webhookUrl ?? null,
      webhookEvents: dto.webhookEvents ?? [],
    });
    return this.repo.save(entity);
  }

  findAll(): Promise<InstanceEntity[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async findOne(id: string): Promise<InstanceEntity> {
    const entity = await this.repo.findOne({ where: { id } });
    if (!entity) throw new NotFoundException(`Instância ${id} não encontrada`);
    return entity;
  }

  findByName(name: string): Promise<InstanceEntity | null> {
    return this.repo.findOne({ where: { name } });
  }

  findByApiKey(apiKey: string): Promise<InstanceEntity | null> {
    return this.repo.findOne({ where: { apiKey } });
  }

  async updateStatus(
    id: string,
    status: ConnectionStatus,
    wid?: string | null,
  ): Promise<void> {
    await this.repo.update({ id }, { status, ...(wid !== undefined ? { wid } : {}) });
  }

  async updateProvider(id: string, provider: InstanceEntity['provider']): Promise<void> {
    await this.repo.update({ id }, { provider });
  }

  async setWebhook(id: string, url: string | undefined, events: string[] = []): Promise<InstanceEntity> {
    await this.findOne(id);
    // URL vazia/omitida desabilita o webhook (webhookUrl = null).
    await this.repo.update({ id }, { webhookUrl: url?.trim() || null, webhookEvents: events });
    return this.findOne(id);
  }

  /**
   * Config efetiva de eventos: usa `eventsConfig` quando presente; senão deriva
   * do legado (webhookUrl/webhookEvents) — assim instâncias antigas já vêm com
   * o webhook preenchido no painel.
   */
  effectiveEvents(inst: InstanceEntity): InstanceEventsConfig {
    const stored = (inst.eventsConfig ?? {}) as Partial<InstanceEventsConfig>;
    return {
      webhook: stored.webhook ?? {
        enabled: !!inst.webhookUrl,
        url: inst.webhookUrl ?? '',
        events: inst.webhookEvents ?? [],
      },
      websocket: stored.websocket ?? { ...EMPTY_EVENTS_CONFIG.websocket },
      rabbitmq: stored.rabbitmq ?? { ...EMPTY_EVENTS_CONFIG.rabbitmq },
    };
  }

  /**
   * Grava a config completa de eventos. Mantém webhookUrl/webhookEvents em
   * sincronia com eventsConfig.webhook (o WebhookProcessor lê os legados).
   */
  async setEvents(id: string, config: InstanceEventsConfig): Promise<InstanceEntity> {
    const inst = await this.findOne(id);
    // `save` (não `update`) evita a fricção do QueryDeepPartialEntity com jsonb.
    inst.eventsConfig = config as unknown as Record<string, unknown>;
    inst.webhookUrl = config.webhook.enabled ? config.webhook.url.trim() || null : null;
    inst.webhookEvents = config.webhook.events;
    return this.repo.save(inst);
  }

  /** Rotaciona o segredo HMAC do webhook. Retorna o novo segredo. */
  async rotateWebhookSecret(id: string): Promise<string> {
    const secret = `whsec_${randomBytes(24).toString('hex')}`;
    await this.repo.update({ id }, { webhookSecret: secret });
    return secret;
  }

  /** Whitelist/blacklist de JIDs. */
  async setFilters(
    id: string,
    filters: { allowJids: string[]; blockJids: string[]; direction: string },
  ): Promise<InstanceEntity> {
    const inst = await this.findOne(id);
    inst.filters = filters as unknown as Record<string, unknown>;
    return this.repo.save(inst);
  }

  /** Política de exposição do remoteJid. */
  async setIdentityMode(id: string, mode: string): Promise<InstanceEntity> {
    await this.repo.update({ id }, { identityMode: mode });
    return this.findOne(id);
  }

  /** Merge do patch anti-ban em config.antiBan. */
  async setAntiBan(id: string, patch: Record<string, unknown>): Promise<InstanceEntity> {
    const inst = await this.findOne(id);
    inst.config = { ...inst.config, antiBan: { ...(inst.config.antiBan as object), ...patch } };
    return this.repo.save(inst);
  }

  async remove(id: string): Promise<void> {
    const res = await this.repo.delete({ id });
    if (!res.affected) throw new NotFoundException(`Instância ${id} não encontrada`);
  }
}
