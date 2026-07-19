import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotImplementedException,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyAction } from '@wamux/shared';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { ChangeProviderDto } from './dto/change-provider.dto';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { SetWebhookDto } from './dto/set-webhook.dto';
import { SetEventsDto } from './dto/set-events.dto';
import { InstanceEntity } from './instance.entity';
import { InstanceService } from './instance.service';
import { AntiBanConfig, zAntiBanUpdate } from '@wamux/shared';
import { InstanceManagerService } from './instance-manager.service';
import { JidFilterService } from '../common/jid-filter.service';
import { WebhookService } from '../webhook/webhook.service';
import { AntiBanService } from '../throttle/anti-ban.service';
import { RiskMonitorService } from '../throttle/risk-monitor.service';
import { SetFiltersDto } from './dto/set-filters.dto';
import { PairCodeDto } from './dto/pair-code.dto';
import { SetInstanceSettingsDto } from './dto/set-instance-settings.dto';

@Controller('instances')
export class InstanceController {
  constructor(
    private readonly instances: InstanceService,
    private readonly manager: InstanceManagerService,
    private readonly jidFilter: JidFilterService,
    private readonly webhooks: WebhookService,
    private readonly antiBan: AntiBanService,
    private readonly riskMonitor: RiskMonitorService,
  ) {}

  /** Cria uma instância e escolhe o provider (baileys | webjs | cloud | whatsmeow). */
  @Post()
  @UseGuards(GlobalApiKeyGuard)
  async create(@Body() dto: CreateInstanceDto) {
    const inst = await this.instances.create(dto);
    return this.present(inst, true);
  }

  @Get()
  @UseGuards(GlobalApiKeyGuard)
  async list() {
    const all = await this.instances.findAll();
    const activity = await this.instances.lastActivityMap();
    return all.map((i) => ({
      ...this.present(i),
      lastActivityAt: activity.get(i.id)?.toISOString() ?? null,
    }));
  }

  @Get(':id')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  async get(@Param('id') id: string) {
    const inst = await this.instances.findOne(id);
    const live = this.manager.getLive(id);
    return { ...this.present(inst), liveStatus: live?.getStatus() ?? null };
  }

  /** Inicia a conexão (restaura sessão ou inicia pareamento por QR). */
  @Post(':id/connect')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  async connect(@Param('id') id: string) {
    return this.manager.connect(id);
  }

  /** Retorna o QR atual (string + PNG dataURL). Null quando não aplicável. */
  @Get(':id/qr')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  async qr(@Param('id') id: string) {
    const qr = await this.manager.getQRCode(id);
    return qr ?? { qr: null, qrImage: null, message: 'Sem QR (já conectado ou Cloud API)' };
  }

  @Post(':id/logout')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  @HttpCode(200)
  async logout(@Param('id') id: string) {
    await this.manager.logout(id);
    return { ok: true };
  }

  @Put(':id/webhook')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  async setWebhook(@Param('id') id: string, @Body() dto: SetWebhookDto) {
    const inst = await this.instances.setWebhook(id, dto.url, dto.events ?? []);
    // Expõe o segredo HMAC: cria na 1ª vez ou quando rotateSecret=true.
    const rotate = (dto as { rotateSecret?: boolean }).rotateSecret;
    const secret =
      rotate || !inst.webhookSecret
        ? await this.instances.rotateWebhookSecret(id)
        : inst.webhookSecret;
    return { ...this.present(inst), webhookSecret: secret };
  }

  /** Whitelist/blacklist de JIDs. */
  @Put(':id/filters')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  async setFilters(@Param('id') id: string, @Body() dto: SetFiltersDto) {
    const inst = await this.instances.setFilters(id, {
      allowJids: dto.allowJids ?? [],
      blockJids: dto.blockJids ?? [],
      direction: dto.direction ?? 'both',
    });
    this.jidFilter.invalidate(id);
    return this.present(inst);
  }

  /** Pairing por código de 8 dígitos (alternativa ao QR). */
  @Post(':id/pair-code')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  async pairCode(@Param('id') id: string, @Body() dto: PairCodeDto) {
    return this.manager.pairCode(id, dto.phone);
  }

  /** DLQ de webhook desta instância. */
  @Get(':id/webhook/dlq')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  listDlq(@Param('id') id: string) {
    return this.webhooks.listDlq(id);
  }

  @Post(':id/webhook/dlq/retry')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  @HttpCode(200)
  retryDlq(@Param('id') id: string) {
    return this.webhooks.retryDlq(id);
  }

  /** Perfil anti-ban da instância. Validado por Zod (estilo Settings). */
  @Put(':id/anti-ban')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  async setAntiBan(@Param('id') id: string, @Body() body: unknown) {
    const parsed = zAntiBanUpdate.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
      );
    }
    const inst = await this.instances.setAntiBan(id, parsed.data as Record<string, unknown>);
    return this.antiBan.resolve(inst.config.antiBan as Partial<AntiBanConfig>);
  }

  /** Config por instância: política de identidade (lid/phone/auto). */
  @Put(':id/settings')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  async setSettings(@Param('id') id: string, @Body() dto: SetInstanceSettingsDto) {
    const inst = await this.instances.setIdentityMode(id, dto.identityMode ?? 'auto');
    return this.present(inst);
  }

  @Get(':id/anti-ban/status')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  async antiBanStatus(@Param('id') id: string) {
    const inst = await this.instances.findOne(id);
    const cfg = this.antiBan.resolve(inst.config.antiBan as Partial<AntiBanConfig>);
    const cap = this.antiBan.effectiveDailyCap(cfg);
    return {
      profile: cfg.profile,
      limits: cfg.limits,
      warmup: {
        active: cfg.warmup.enabled && !!cfg.warmupStartedAt,
        dailyCapToday: cap,
        startedAt: cfg.warmupStartedAt ?? null,
      },
      throttle: {
        active: await this.antiBan.isThrottled(id),
        cooldownRemainingSec: await this.riskMonitor.throttleTtl(id),
      },
      today: { used: await this.antiBan.dailyUsed(id), cap },
      rate: await this.antiBan.rate(id, cfg),
    };
  }

  /** Config de eventos (webhook + websocket + rabbitmq) da instância. */
  @Put(':id/events')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  async setEvents(@Param('id') id: string, @Body() dto: SetEventsDto) {
    const inst = await this.instances.setEvents(id, {
      webhook: dto.webhook,
      websocket: dto.websocket,
      rabbitmq: dto.rabbitmq,
    });
    this.manager.refreshEventsConfig(id);
    return this.present(inst);
  }

  /** Matriz de recursos que a engine da instância entrega. */
  @Get(':id/capabilities')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  async capabilities(@Param('id') id: string) {
    const provider = await this.manager.requireLive(id);
    return provider.capabilities;
  }

  /** Nome/foto da própria conta conectada. 501 uniforme se a engine não suportar. */
  @Get(':id/profile')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  async profile(@Param('id') id: string) {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.profile || !provider.getProfile) {
      throw new NotImplementedException(`A engine "${provider.type}" não suporta perfil.`);
    }
    return provider.getProfile();
  }

  /** Troca a engine (opcionalmente migrando credenciais, sem reparear). */
  @Post(':id/provider')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  async changeProvider(@Param('id') id: string, @Body() dto: ChangeProviderDto) {
    return this.manager.changeProvider(id, dto.provider, dto.migrate ?? false);
  }

  @Delete(':id')
  @UseGuards(GlobalApiKeyGuard)
  @HttpCode(200)
  async remove(@Param('id') id: string) {
    await this.manager.logout(id);
    await this.instances.remove(id);
    return { ok: true };
  }

  /** Serialização segura (só expõe a apiKey na criação). */
  private present(inst: InstanceEntity, withKey = false) {
    return {
      id: inst.id,
      name: inst.name,
      provider: inst.provider,
      status: inst.status,
      wid: inst.wid ?? null,
      webhookUrl: inst.webhookUrl ?? null,
      webhookEvents: inst.webhookEvents ?? [],
      events: this.instances.effectiveEvents(inst),
      createdAt: inst.createdAt,
      ...(withKey ? { apiKey: inst.apiKey } : {}),
    };
  }
}
