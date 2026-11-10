import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DEFAULT_SETTINGS, SettingsUpdate, WamuxSettings } from '@wamux/shared';
import { SettingsEntity } from './settings.entity';

const ROW_ID = 'global';

/**
 * Configurações globais com cache em memória. Defaults vêm do .env; overrides
 * (editados no painel) são persistidos no banco e mesclados por cima.
 * O cache evita hit no banco a cada envio (rate limit).
 */
@Injectable()
export class SettingsService implements OnModuleInit {
  private cache: WamuxSettings = DEFAULT_SETTINGS;

  constructor(
    @InjectRepository(SettingsEntity)
    private readonly repo: Repository<SettingsEntity>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const row = await this.repo.findOne({ where: { id: ROW_ID } });
    this.cache = this.merge(this.envDefaults(), row?.data ?? {});
  }

  /** Configurações efetivas (sincrono, do cache). */
  get(): WamuxSettings {
    return this.cache;
  }

  async update(patch: SettingsUpdate): Promise<WamuxSettings> {
    const row =
      (await this.repo.findOne({ where: { id: ROW_ID } })) ??
      this.repo.create({ id: ROW_ID, data: {} });
    row.data = this.merge(row.data ?? {}, patch);
    await this.repo.save(row);
    this.cache = this.merge(this.envDefaults(), row.data);
    return this.cache;
  }

  private envDefaults(): WamuxSettings {
    return {
      rateLimit: {
        perSec: this.config.get<number>('rateLimit.perSec') ?? DEFAULT_SETTINGS.rateLimit.perSec,
        burst: this.config.get<number>('rateLimit.burst') ?? DEFAULT_SETTINGS.rateLimit.burst,
      },
      webhookGlobal: {
        enabled:
          this.config.get<boolean>('webhookGlobal.enabled') ??
          DEFAULT_SETTINGS.webhookGlobal.enabled,
        url: this.config.get<string>('webhookGlobal.url') ?? DEFAULT_SETTINGS.webhookGlobal.url,
      },
      device: {
        client: this.config.get<string>('device.client') ?? DEFAULT_SETTINGS.device.client,
        browser: this.config.get<string>('device.browser') ?? DEFAULT_SETTINGS.device.browser,
      },
    };
  }

  /** Merge raso de 2 níveis (as seções são objetos planos). */
  private merge(
    base: WamuxSettings | Partial<WamuxSettings>,
    over: {
      rateLimit?: Partial<WamuxSettings['rateLimit']>;
      webhookGlobal?: Partial<WamuxSettings['webhookGlobal']>;
      device?: Partial<WamuxSettings['device']>;
    },
  ): WamuxSettings {
    const b = { ...DEFAULT_SETTINGS, ...base } as WamuxSettings;
    return {
      rateLimit: { ...b.rateLimit, ...over.rateLimit },
      webhookGlobal: { ...b.webhookGlobal, ...over.webhookGlobal },
      device: { ...b.device, ...over.device },
    };
  }
}
