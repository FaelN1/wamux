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
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import { ApiKeyAction, ConnectionStatus, ProviderType } from '@wamux/shared';
import { ID_PARAM, OK_SCHEMA } from '../common/openapi';
import { GlobalApiKeyGuard } from '../common/guards/global-api-key.guard';
import { InstanceApiKeyGuard } from '../common/guards/instance-api-key.guard';
import { RequireScope } from '../common/require-scope.decorator';
import { ChangeProviderDto } from './dto/change-provider.dto';
import { CreateInstanceDto } from './dto/create-instance.dto';
import { SetWebhookDto } from './dto/set-webhook.dto';
import { SetEventsDto } from './dto/set-events.dto';
import { UpdateOwnProfileDto } from './dto/update-own-profile.dto';
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

// ── Schemas reutilizáveis de resposta (documentam "o que retorna" no OpenAPI) ──

const STREAM_TRANSPORT_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    events: { type: 'array', items: { type: 'string' }, description: 'vazio = todos' },
  },
};

const EVENTS_CONFIG_SCHEMA: SchemaObject = {
  type: 'object',
  description: 'Entrega de eventos por transporte (webhook + websocket + rabbitmq).',
  properties: {
    webhook: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        url: { type: 'string' },
        events: { type: 'array', items: { type: 'string' } },
      },
    },
    websocket: STREAM_TRANSPORT_SCHEMA,
    rabbitmq: STREAM_TRANSPORT_SCHEMA,
  },
};

/** Forma "apresentada" da instância (present()) — base reutilizada por várias rotas. */
const INSTANCE_PROPERTIES: Record<string, SchemaObject> = {
  id: { type: 'string', format: 'uuid' },
  name: { type: 'string', example: 'vendas-01' },
  provider: { type: 'string', enum: Object.values(ProviderType) },
  status: { type: 'string', enum: Object.values(ConnectionStatus) },
  wid: {
    type: 'string',
    nullable: true,
    description: 'número/jid conectado (null enquanto não conecta)',
    example: '5511999999999@s.whatsapp.net',
  },
  webhookUrl: { type: 'string', nullable: true },
  webhookEvents: { type: 'array', items: { type: 'string' }, description: 'vazio = todos' },
  events: EVENTS_CONFIG_SCHEMA,
  createdAt: { type: 'string', format: 'date-time' },
};

/** Monta o schema da instância apresentada, com propriedades extras opcionais. */
function instanceSchema(extra: Record<string, SchemaObject> = {}): SchemaObject {
  return { type: 'object', properties: { ...INSTANCE_PROPERTIES, ...extra } };
}

const ANTI_BAN_LIMITS_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    perMinute: { type: 'number' },
    perDay: { type: 'number' },
    burst: { type: 'number', description: 'capacidade (burst) do token bucket' },
  },
};

/** Corpo de PUT /anti-ban (espelha o zAntiBanUpdate). */
const ANTI_BAN_UPDATE_SCHEMA: SchemaObject = {
  type: 'object',
  required: ['profile'],
  properties: {
    profile: { type: 'string', enum: ['conservative', 'normal', 'aggressive'] },
    maxPerMinute: { type: 'number', description: '1..120' },
    maxPerDay: { type: 'number', description: '1..50000' },
    warmup: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        days: { type: 'number', description: '0..60' },
        startPerDay: { type: 'number' },
      },
    },
    humanize: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        minDelayMs: { type: 'number' },
        maxDelayMs: { type: 'number' },
        composing: { type: 'boolean', description: 'simula "digitando…"' },
        msPerChar: { type: 'number' },
        maxComposingMs: { type: 'number' },
      },
    },
  },
};

/** Resposta de PUT /anti-ban (config anti-ban resolvida). */
const ANTI_BAN_CONFIG_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    profile: { type: 'string' },
    limits: ANTI_BAN_LIMITS_SCHEMA,
    warmup: { type: 'object', description: 'config de aquecimento (rampa)' },
    humanize: { type: 'object', description: 'config de humanização de envio' },
    autoThrottle: { type: 'object', description: 'freio automático por sinais de risco' },
    warmupStartedAt: {
      type: 'number',
      nullable: true,
      description: 'epoch(ms) do 1º connect (âncora da rampa)',
    },
  },
};

/** Resposta de GET /anti-ban/status. */
const ANTI_BAN_STATUS_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    profile: { type: 'string' },
    limits: ANTI_BAN_LIMITS_SCHEMA,
    warmup: {
      type: 'object',
      properties: {
        active: { type: 'boolean' },
        dailyCapToday: { type: 'number' },
        startedAt: { type: 'number', nullable: true },
      },
    },
    throttle: {
      type: 'object',
      properties: {
        active: { type: 'boolean' },
        cooldownRemainingSec: { type: 'number' },
      },
    },
    today: {
      type: 'object',
      properties: { used: { type: 'number' }, cap: { type: 'number' } },
    },
    rate: { type: 'object', description: 'uso/limite instantâneo do token bucket' },
  },
};

/** Resposta de GET /capabilities (matriz ProviderCapabilities). */
const CAPABILITY_FLAGS = [
  'labels',
  'block',
  'presence',
  'fetchMessages',
  'checkNumbers',
  'markRead',
  'media',
  'newsletter',
  'newsletterMedia',
  'newsletterPoll',
  'groups',
  'communities',
  'profile',
  'orders',
  'updateOwnProfile',
  'statusEmoji',
  'contactAvatar',
  'history',
  'reactions',
  'editMessage',
  'deleteMessage',
  'location',
  'contact',
  'status',
  'templates',
  'updateProfile',
  'cloudAccount',
  'flows',
  'cloudGroups',
  'calling',
  'poll',
  'pollResults',
  'buttons',
  'list',
  'pix',
];

const CAPABILITIES_SCHEMA: SchemaObject = {
  type: 'object',
  description: 'Matriz de recursos da engine (ProviderCapabilities). Flag ausente = não suportado.',
  properties: {
    ...Object.fromEntries(
      CAPABILITY_FLAGS.map((k): [string, SchemaObject] => [k, { type: 'boolean' }]),
    ),
    newsletterUnsupportedMediaTypes: {
      type: 'array',
      items: { type: 'string' },
      description: 'tipos de mídia não aceitos em canal mesmo com newsletterMedia',
    },
  },
};

/** Resposta de GET /profile (ProfileInfo). */
const PROFILE_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    jid: { type: 'string', description: 'jid da própria conta' },
    name: { type: 'string', description: 'nome de exibição (pushName)' },
    status: { type: 'string', description: 'recado/"about"' },
    profilePicUrl: { type: 'string' },
  },
};

/** Resposta de GET /:id/orders/:orderId (OrderDetails). */
const ORDER_SCHEMA: SchemaObject = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    createdAt: { type: 'number', description: 'unix (s)' },
    catalogId: { type: 'string' },
    price: {
      type: 'object',
      properties: {
        subtotal: { type: 'number', description: 'menor unidade da moeda (centavos)' },
        total: { type: 'number', description: 'menor unidade da moeda (centavos)' },
        currency: { type: 'string' },
        status: { type: 'string', description: 'ex.: pending enquanto o vendedor não fecha' },
      },
    },
    products: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          price: { type: 'number', description: 'menor unidade da moeda (centavos)' },
          currency: { type: 'string' },
          quantity: { type: 'number' },
          imageUrl: { type: 'string' },
          variant: { type: 'string', description: 'variação escolhida (tamanho, cor…)' },
        },
      },
    },
  },
};

@ApiTags('Instâncias')
@ApiSecurity('apikey')
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

  @Post()
  @UseGuards(GlobalApiKeyGuard)
  @ApiOperation({
    summary: 'Cria uma instância',
    description:
      'Cria a instância e fixa o provider (baileys | webjs | cloud | whatsmeow). ' +
      'Requer a GLOBAL_API_KEY. A apiKey própria da instância só é retornada aqui.',
  })
  @ApiCreatedResponse({
    description: 'Instância criada — inclui a apiKey (guarde-a, não é retornada de novo).',
    schema: instanceSchema({
      apiKey: { type: 'string', description: 'chave própria da instância (só na criação)' },
    }),
  })
  async create(@Body() dto: CreateInstanceDto) {
    const inst = await this.instances.create(dto);
    return this.present(inst, true);
  }

  @Get()
  @UseGuards(GlobalApiKeyGuard)
  @ApiOperation({ summary: 'Lista todas as instâncias', description: 'Requer a GLOBAL_API_KEY.' })
  @ApiOkResponse({
    description: 'Instâncias cadastradas.',
    schema: {
      type: 'array',
      items: instanceSchema({
        lastActivityAt: {
          type: 'string',
          format: 'date-time',
          nullable: true,
          description: 'ISO da última mensagem enviada/recebida (null se nunca houve)',
        },
      }),
    },
  })
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
  @ApiOperation({
    summary: 'Detalhe de uma instância',
    description: 'Inclui o status ao vivo do provider em memória neste worker (liveStatus).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    schema: instanceSchema({
      liveStatus: {
        type: 'string',
        nullable: true,
        description: 'status do provider ao vivo (null se não estiver em memória neste worker)',
      },
    }),
  })
  async get(@Param('id') id: string) {
    const inst = await this.instances.findOne(id);
    const live = this.manager.getLive(id);
    return { ...this.present(inst), liveStatus: live?.getStatus() ?? null };
  }

  @Post(':id/connect')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Inicia a conexão',
    description: 'Restaura a sessão persistida ou inicia o pareamento por QR.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    description: 'Status resultante.',
    schema: {
      type: 'object',
      properties: { status: { type: 'string', enum: Object.values(ConnectionStatus) } },
    },
  })
  async connect(@Param('id') id: string) {
    return this.manager.connect(id);
  }

  @Get(':id/qr')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'QR atual',
    description:
      'String do QR + PNG (data:URL). Campos null quando não aplicável (já conectado ou Cloud API).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        qr: { type: 'string', nullable: true },
        qrImage: { type: 'string', nullable: true, description: 'PNG em data:URL' },
        message: { type: 'string' },
      },
    },
  })
  async qr(@Param('id') id: string) {
    const qr = await this.manager.getQRCode(id);
    return qr ?? { qr: null, qrImage: null, message: 'Sem QR (já conectado ou Cloud API)' };
  }

  @Post(':id/logout')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Encerra a sessão',
    description: 'Faz logout e dropa as credenciais — exige reparear (QR/pairing) para reconectar.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: OK_SCHEMA })
  async logout(@Param('id') id: string) {
    await this.manager.logout(id);
    return { ok: true };
  }

  @Put(':id/webhook')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Define o webhook da instância',
    description:
      'Define URL + eventos. O segredo HMAC é criado na 1ª vez (ou quando rotateSecret=true) e ' +
      'só é retornado nesta resposta — guarde-o para validar as assinaturas.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    schema: instanceSchema({
      webhookSecret: {
        type: 'string',
        description: 'segredo HMAC — retornado só na criação/rotação',
      },
    }),
  })
  async setWebhook(@Param('id') id: string, @Body() dto: SetWebhookDto) {
    const inst = await this.instances.setWebhook(id, dto.url, dto.events ?? []);
    // Expõe o segredo HMAC: cria na 1ª vez ou quando rotateSecret=true.
    const secret =
      dto.rotateSecret || !inst.webhookSecret
        ? await this.instances.rotateWebhookSecret(id)
        : inst.webhookSecret;
    return { ...this.present(inst), webhookSecret: secret };
  }

  @Put(':id/filters')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({ summary: 'Whitelist/blacklist de JIDs' })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: instanceSchema() })
  async setFilters(@Param('id') id: string, @Body() dto: SetFiltersDto) {
    const inst = await this.instances.setFilters(id, {
      allowJids: dto.allowJids ?? [],
      blockJids: dto.blockJids ?? [],
      direction: dto.direction ?? 'both',
    });
    this.jidFilter.invalidate(id);
    return this.present(inst);
  }

  @Post(':id/pair-code')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Pairing por código',
    description: 'Gera um código de 8 dígitos para parear pelo celular (alternativa ao QR).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    schema: { type: 'object', properties: { code: { type: 'string', example: 'ABCD1234' } } },
  })
  async pairCode(@Param('id') id: string, @Body() dto: PairCodeDto) {
    return this.manager.pairCode(id, dto.phone);
  }

  @Get(':id/webhook/dlq')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'DLQ do webhook',
    description: 'Entregas de webhook desta instância que falharam (dead-letter).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          event: { type: 'string' },
          attemptsMade: { type: 'number' },
          failedReason: { type: 'string' },
          timestamp: { type: 'number', description: 'unix (ms)' },
        },
      },
    },
  })
  listDlq(@Param('id') id: string) {
    return this.webhooks.listDlq(id);
  }

  @Post(':id/webhook/dlq/retry')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Reprocessa a DLQ',
    description: 'Re-enfileira todas as entregas de webhook falhas desta instância.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    schema: { type: 'object', properties: { retried: { type: 'number' } } },
  })
  retryDlq(@Param('id') id: string) {
    return this.webhooks.retryDlq(id);
  }

  @Put(':id/anti-ban')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Configura o perfil anti-ban',
    description: 'Validado por Zod (estilo Settings). Retorna a config anti-ban resolvida.',
  })
  @ApiParam(ID_PARAM)
  @ApiBody({ schema: ANTI_BAN_UPDATE_SCHEMA })
  @ApiOkResponse({ schema: ANTI_BAN_CONFIG_SCHEMA })
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

  @Put(':id/settings')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Config da instância',
    description: 'Política de identidade (lid/phone/auto).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: instanceSchema() })
  async setSettings(@Param('id') id: string, @Body() dto: SetInstanceSettingsDto) {
    const inst = await this.instances.setIdentityMode(id, dto.identityMode ?? 'auto');
    return this.present(inst);
  }

  @Get(':id/anti-ban/status')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Status anti-ban',
    description: 'Limites efetivos, warmup, throttle e uso do dia.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: ANTI_BAN_STATUS_SCHEMA })
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

  @Put(':id/events')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Config de eventos',
    description: 'Entrega por transporte (webhook + websocket + rabbitmq).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: instanceSchema() })
  async setEvents(@Param('id') id: string, @Body() dto: SetEventsDto) {
    const inst = await this.instances.setEvents(id, {
      webhook: dto.webhook,
      websocket: dto.websocket,
      rabbitmq: dto.rabbitmq,
    });
    this.manager.refreshEventsConfig(id);
    return this.present(inst);
  }

  @Get(':id/capabilities')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Capacidades da engine',
    description: 'Matriz de recursos que a engine da instância entrega.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: CAPABILITIES_SCHEMA })
  async capabilities(@Param('id') id: string) {
    const provider = await this.manager.requireLive(id);
    return provider.capabilities;
  }

  @Get(':id/profile')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Perfil da conta conectada',
    description: 'Nome/foto da própria conta. 501 uniforme se a engine não suportar.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: PROFILE_SCHEMA })
  async profile(@Param('id') id: string) {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.profile || !provider.getProfile) {
      throw new NotImplementedException(`A engine "${provider.type}" não suporta perfil.`);
    }
    return provider.getProfile();
  }

  @Put(':id/profile')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.SETTING)
  @ApiOperation({
    summary: 'Edita o perfil da conta conectada',
    description:
      'Nome, recado e foto da própria conta. `statusEmoji`/`statusDurationSec` exigem ' +
      'capabilities.statusEmoji (hoje só whatsmeow, via hypermeow) e são ignorados nas demais. ' +
      '501 uniforme se a engine não permitir editar o perfil.',
  })
  @ApiParam(ID_PARAM)
  @ApiBody({ type: UpdateOwnProfileDto })
  @ApiOkResponse({ schema: OK_SCHEMA })
  async updateOwnProfile(@Param('id') id: string, @Body() dto: UpdateOwnProfileDto) {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.updateOwnProfile || !provider.updateOwnProfile) {
      throw new NotImplementedException(
        `A engine "${provider.type}" não permite editar o perfil da conta.`,
      );
    }
    if (dto.statusEmoji && !provider.capabilities.statusEmoji) {
      throw new UnprocessableEntityException({
        code: 'statusEmojiUnsupported',
        provider: provider.type,
        message: `Emoji no recado não é suportado na engine "${provider.type}".`,
      });
    }
    await provider.updateOwnProfile(dto);
    return { ok: true };
  }

  @Get(':id/orders/:orderId')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.READ)
  @ApiOperation({
    summary: 'Itens de um pedido do catálogo Business',
    description:
      'A mensagem de pedido carrega só o id e um token opaco — os itens exigem esta consulta. ' +
      'Só a engine whatsmeow implementa (o fork hypermeow adicionou GetOrderDetails); ' +
      'as demais respondem 501 uniforme.',
  })
  @ApiParam(ID_PARAM)
  @ApiParam({ name: 'orderId', description: 'id do pedido, vindo da mensagem recebida' })
  @ApiQuery({ name: 'token', description: 'token opaco que acompanha o pedido na mensagem' })
  @ApiOkResponse({ schema: ORDER_SCHEMA })
  async orderDetails(
    @Param('id') id: string,
    @Param('orderId') orderId: string,
    @Query('token') token: string,
  ) {
    const provider = await this.manager.requireLive(id);
    if (!provider.capabilities.orders || !provider.getOrderDetails) {
      throw new NotImplementedException(
        `A engine "${provider.type}" não suporta pedidos do catálogo.`,
      );
    }
    if (!token) {
      throw new BadRequestException('Informe o "token" do pedido (vem na mensagem recebida).');
    }
    try {
      return await provider.getOrderDetails({ orderId, token });
    } catch (e) {
      // O servidor do WhatsApp responde erro genérico para pedido inexistente,
      // token inválido ou expirado — indistinguíveis daqui. Vira 422 com a
      // mensagem da engine, em vez do 500 "Erro interno" que esconderia a causa.
      throw new UnprocessableEntityException({
        code: 'orderLookupFailed',
        provider: provider.type,
        message: (e as Error).message,
      });
    }
  }

  @Post(':id/provider')
  @UseGuards(InstanceApiKeyGuard)
  @RequireScope(ApiKeyAction.CONTROL)
  @ApiOperation({
    summary: 'Troca a engine',
    description: 'Troca o provider, opcionalmente migrando as credenciais (sem reparear).',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        migrated: { type: 'boolean', description: 'credenciais migradas com sucesso?' },
        requiresQr: { type: 'boolean', description: 'precisa reparear por QR?' },
        message: { type: 'string' },
      },
    },
  })
  async changeProvider(@Param('id') id: string, @Body() dto: ChangeProviderDto) {
    return this.manager.changeProvider(id, dto.provider, dto.migrate ?? false);
  }

  @Delete(':id')
  @UseGuards(GlobalApiKeyGuard)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Remove a instância',
    description: 'Faz logout e apaga a instância. Requer a GLOBAL_API_KEY.',
  })
  @ApiParam(ID_PARAM)
  @ApiOkResponse({ schema: OK_SCHEMA })
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
